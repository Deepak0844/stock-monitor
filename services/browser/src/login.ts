// Automatic supplier login: the step loop that finds and fills a login form, and the rules that read the page after it.
// Runs on a page of the supplier's persistent profile. The username and password are typed into the page and nowhere else.
import type { Frame, Locator, Page } from "playwright";
import { classifyPage, type LoginSelectors, type PageClass, type SessionState } from "@stock-monitor/supplier-session";
import { CHALLENGE_WIDGET, MAX_TEXT } from "./verify.js";

export type LoginResult = "ok" | "captcha" | "code_required" | "wrong_password" | "account_locked" | "blocked" | "form_not_found" | "unreachable" | "unknown";
export type LoginRequest = { loginUrl: string; checkUrl: string; username: string; password: string; account?: string; stealth: boolean; selectors?: LoginSelectors };
/** `state` only when `result` is `ok`. */
export type LoginOutcome = { result: LoginResult; state?: SessionState };
export type AfterSubmitFacts = {
  challengeVisible: boolean;
  codeFieldVisible: boolean;
  secondCheckText: boolean;
  lockedText: boolean;
  passwordFieldVisible: boolean;
  onLoginPage: boolean;
  pageClass: PageClass;
};

// Button and label words, from the spec's "Every login case" tables. Buttons match the whole text; page text matches anywhere.
export const OPEN_WORDS = ["Sign in", "Log in", "Login", "My account"];
export const NEXT_WORDS = ["Next", "Continue", "Sign in", "Log in", "Login"];
export const USE_PASSWORD_WORDS = ["Use password", "Sign in with password"];
export const CONSENT_WORDS = ["Accept", "Accept all", "Allow all", "Agree", "No thanks", "Close", "×"];
export const STAY_SIGNED_IN_WORDS = ["Yes", "Stay signed in"];
export const REMEMBER_ME_WORDS = ["Remember me", "Keep me signed in"];
export const SECOND_CHECK_WORDS = ["approve", "check your phone", "sent a notification", "check your email", "verify"];
export const LOCKED_WORDS = ["account is locked", "account locked", "too many attempts", "temporarily blocked"];

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const whole = (words: string[]) => new RegExp(`^\\s*(?:${words.map(escape).join("|")})\\s*[?!.]?\\s*$`, "i");
const within = (words: string[]) => new RegExp(words.map(escape).join("|"), "i");
const SECOND_CHECK = within(SECOND_CHECK_WORDS);
const LOCKED = within(LOCKED_WORDS);

/**
 * A one-time-code box: the standard autocomplete always counts, else a name, id, placeholder or label that says code, OTP or
 * verification, unless it also says postcode, zip, promo, voucher, discount, coupon or gift (a shop's other code boxes).
 */
export const CODE_WORDS = /code|otp|verification/i;
export const NOT_CODE_WORDS = /post|zip|promo|voucher|discount|coupon|gift/i;

/**
 * What the page says after the password went in. The order is fixed by the spec. Second-check and locked wording only count on a
 * page that is not ok: a logged-in page may well say "verify" or "approve". Only a password box still on the login page is a wrong
 * password; any other login page (security question, expired password, new terms) is unknown.
 */
export function decideAfterSubmit(f: AfterSubmitFacts): LoginResult {
  const notOk = f.pageClass !== "ok";
  if (f.challengeVisible) return "captcha";
  if (notOk && (f.codeFieldVisible || f.secondCheckText)) return "code_required";
  if (notOk && f.lockedText) return "account_locked";
  if (f.passwordFieldVisible && f.onLoginPage) return "wrong_password";
  return f.pageClass === "login_required" ? "unknown" : f.pageClass;
}

const LOGIN_PATH = /\/(?:log-?in|sign-?in|sign_in|log_in)(?:[/?#.]|$)/;
const onLoginPage = (url: string, loginUrl: string) => {
  try {
    const a = new URL(url);
    const b = new URL(loginUrl);
    return LOGIN_PATH.test(a.pathname) || (a.host === b.host && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, ""));
  } catch {
    return false;
  }
};

type Input = { index: number; visible: boolean; empty: boolean; password: boolean; usernameLike: boolean; account: boolean; checkbox: boolean; code: boolean };
type Found = { frame: Frame; field: Locator; empty: boolean } | null;
/** `code`: a visible one-time-code box in the same frame. It is never taken for the username. */
type Fields = { account: Found; username: Found; password: Found; code: boolean };

/** Every input in a frame, in document order (open shadow roots included), with what the rules need to know. In-page. */
async function inputsOf(frame: Frame, overrides: LoginSelectors): Promise<Input[]> {
  return frame
    .locator("input")
    .evaluateAll(
      (els, { o, codeWords, notCodeWords }) =>
        els.map((node, index) => {
          const el = node as HTMLInputElement;
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const visible = box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1;
          const is = (sel: string | undefined) => {
            try {
              return !!sel && el.matches(sel);
            } catch {
              return false;
            }
          };
          const type = el.type.toLowerCase();
          const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase();
          const says = [...(el.labels ?? [])].map((l) => l.textContent ?? "").concat([el.name, el.id, el.placeholder, el.getAttribute("aria-label") ?? ""]).join(" ");
          const accountWords = /account|customer\s*(?:number|no\b)/i.test(says) && type !== "email" && type !== "password" && !/username|email/.test(autocomplete);
          const account = o.account ? is(o.account) : accountWords && (type === "text" || type === "tel" || type === "number");
          const password = o.password ? is(o.password) : type === "password";
          const code = !password && (autocomplete === "one-time-code" || (new RegExp(codeWords, "i").test(says) && !new RegExp(notCodeWords, "i").test(says)));
          return {
            index,
            visible,
            empty: el.value === "",
            password,
            usernameLike: o.username ? is(o.username) : !code && (["email", "text", "tel"].includes(type) || autocomplete === "username"),
            account,
            checkbox: type === "checkbox",
            code,
          };
        }),
      { o: overrides, codeWords: CODE_WORDS.source, notCodeWords: NOT_CODE_WORDS.source },
    )
    .catch(() => []);
}

/** The fields of this step, searched in every frame, visible ones only. The account field is never taken for the username. */
async function findFields(page: Page, overrides: LoginSelectors): Promise<Fields> {
  const none: Fields = { account: null, username: null, password: null, code: false };
  for (const frame of page.frames()) {
    const inputs = (await inputsOf(frame, overrides)).filter((i) => i.visible && !i.checkbox);
    const at = (i: Input | undefined): Found => (i ? { frame, field: frame.locator("input").nth(i.index), empty: i.empty } : null);
    const password = inputs.find((i) => i.password);
    const account = inputs.find((i) => i.account && !i.password);
    const candidates = inputs.filter((i) => i.usernameLike && !i.password && !i.account);
    const username = password ? candidates.filter((i) => i.index < password.index).at(-1) : candidates[0];
    const code = inputs.some((i) => i.code);
    if (password || username || account || code) return { account: at(account), username: at(username), password: at(password), code };
  }
  return none;
}

/** The first visible button or link, in any frame, whose name is one of `words`. */
async function findButton(page: Page, words: RegExp): Promise<Locator | null> {
  for (const frame of page.frames()) {
    for (const role of ["button", "link"] as const) {
      for (const el of await frame.getByRole(role, { name: words }).all().catch(() => [])) if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return null;
}

async function firstVisible(page: Page, selector: string): Promise<Locator | null> {
  for (const frame of page.frames()) {
    for (const el of await frame.locator(selector).all().catch(() => [])) if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

/** A visible one-time-code box in any frame. */
async function codeFieldVisible(page: Page, overrides: LoginSelectors): Promise<boolean> {
  for (const frame of page.frames()) if ((await inputsOf(frame, overrides)).some((i) => i.visible && i.code)) return true;
  return false;
}

async function challengeVisible(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const seen = await frame
      .locator(CHALLENGE_WIDGET)
      .evaluateAll((els) =>
        els.some((el) => {
          // Same rule as the checks: an invisible or off-screen widget (a form's spam guard) is not a puzzle.
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return el.getAttribute("data-size") !== "invisible" && box.width >= 50 && box.height >= 30 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1 && box.bottom > 0 && box.right > 0;
        }),
      )
      .catch(() => false);
    if (seen) return true;
  }
  return false;
}

const typingDelay = () => 40 + Math.floor(Math.random() * 81);
const type = (field: Locator, value: string) => field.pressSequentially(value, { delay: typingDelay() });

export type StepOptions = { settleMs: number; stepWaitMs?: number; maxSteps?: number };

/**
 * Logs in on `page`, which is already in the supplier's profile: open the login page, run the step loop, read the page after
 * the password, confirm on `checkUrl`. Returns only the result; the caller reads the session when it is `ok`.
 */
export async function runLogin(page: Page, request: LoginRequest, { settleMs, stepWaitMs = 15_000, maxSteps = 5 }: StepOptions): Promise<LoginResult> {
  const selectors = request.selectors ?? {};
  let navigations = 0;
  let status: number | null = null;
  page.on("framenavigated", () => void navigations++);
  page.on("response", (r) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status();
  });

  const signature = async () => {
    const parts: string[] = [];
    for (const frame of page.frames()) {
      const inputs = await frame.locator("input").evaluateAll((els) =>
        els
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
          })
          .map((el) => `${(el as HTMLInputElement).type}:${(el as HTMLInputElement).name}:${el.id}`)
          .join(","),
      ).catch(() => "");
      parts.push(`${frame.url()}|${inputs}`);
    }
    return parts.join(" ");
  };
  /** Waits until a frame navigates or the visible fields change. false when nothing changed in time. */
  const waitForChange = async (before: string, navsBefore: number, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (navigations > navsBefore || (await signature()) !== before) {
        await page.waitForLoadState("load", { timeout: Math.max(1, end - Date.now()) }).catch(() => {});
        return true;
      }
      await page.waitForTimeout(250);
    }
    return false;
  };
  const afterAction = async (action: () => Promise<void>, ms: number) => {
    const before = await signature();
    const navsBefore = navigations;
    await action();
    return waitForChange(before, navsBefore, ms);
  };

  let consentUsed = false;
  /** A click that, once per login, clears a cookie banner or popup that covers its target. */
  const click = async (target: Locator) => {
    try {
      await target.click({ timeout: 3000 });
    } catch (error) {
      if (consentUsed || !/intercepts pointer events/i.test(error instanceof Error ? error.message : "")) throw error;
      consentUsed = true;
      const consent = await findButton(page, whole(CONSENT_WORDS));
      if (!consent) throw error;
      await consent.click({ timeout: 3000 });
      await target.click({ timeout: 3000 });
    }
  };

  const classifyHere = async (requestedUrl: string) => {
    const seen = await page.evaluate(() => ({ title: document.title, text: (document.body?.innerText ?? "").slice(0, 20_000) })).catch(() => ({ title: "", text: "" }));
    return classifyPage({
      requestedUrl,
      loginUrl: request.loginUrl,
      page: { finalUrl: page.url(), status, title: seen.title, text: seen.text.slice(0, MAX_TEXT), hasPasswordField: !!(await firstVisible(page, 'input[type="password"]')), hasChallengeWidget: await challengeVisible(page) },
    });
  };
  const anyFormVisible = async () => {
    const f = await findFields(page, selectors);
    return !!(f.password || f.username || f.account);
  };

  // 1. The login page.
  try {
    status = (await page.goto(request.loginUrl, { timeout: 20_000, waitUntil: "load" }))?.status() ?? null;
  } catch {
    return "unreachable";
  }
  if (status === 429) return "unreachable";
  let first = await classifyHere(request.loginUrl);
  if (first === "unreachable") return "unreachable";
  if (await challengeVisible(page)) return "captcha";
  // A "checking your browser" page that passes by itself. The classifier calls it captcha (its words) or blocked.
  if ((first === "captcha" || first === "blocked") && !(await anyFormVisible())) {
    await waitForChange(await signature(), navigations, stepWaitMs);
    first = await classifyHere(request.loginUrl);
    if ((first === "captcha" || first === "blocked") && !(await anyFormVisible())) return (await challengeVisible(page)) ? "captcha" : "blocked";
  }

  // 2. The step loop, unless the profile is still logged in.
  if (first !== "ok") {
    let opened = false;
    let submitted = false;
    let typedUsername = false;
    let typedAccount = false;
    for (let step = 0; step < maxSteps && !submitted; step++) {
      if (await challengeVisible(page)) return "captcha";
      const f = await findFields(page, selectors);
      // A code box counts only on a step with no username or password box: a login form can sit next to a shop's other boxes.
      if (f.code && !f.username && !f.password) return "code_required";

      if (!f.username && !f.password && !f.account) {
        // A choice screen ("Use password" / "Send me a code"), else the button that opens the login.
        const choice = await findButton(page, whole(USE_PASSWORD_WORDS));
        if (choice) {
          if (!(await afterAction(() => click(choice), stepWaitMs))) return "form_not_found";
          continue;
        }
        if (opened) return "form_not_found";
        opened = true;
        const opener = selectors.open ? await firstVisible(page, selectors.open) : await findButton(page, whole(OPEN_WORDS));
        if (!opener) return "form_not_found";
        if (!(await afterAction(() => click(opener), stepWaitMs))) return "form_not_found";
        continue;
      }

      // An override that is not on the page is never guessed around.
      if (selectors.username && !f.username && !typedUsername) return "form_not_found";
      if (selectors.account && !f.account && request.account && !typedAccount) return "form_not_found";
      // A password override that is missing is only fine on a username step of a two-step login, never after it.
      if (selectors.password && !f.password && (!f.username?.empty || typedUsername)) return "form_not_found";

      let last: Locator | null = null;
      const frame = (f.password ?? f.username ?? f.account)!.frame;
      if (f.account?.empty) {
        if (!request.account) return "form_not_found"; // the page needs an account number and none is saved
        await type(f.account.field, request.account);
        typedAccount = true;
        last = f.account.field;
      }
      if (f.username?.empty) {
        await type(f.username.field, request.username);
        typedUsername = true;
        last = f.username.field;
      }
      if (f.password) {
        await f.password.field.fill("");
        await type(f.password.field, request.password);
        last = f.password.field;
        const remember = await findCheckbox(frame, within(REMEMBER_ME_WORDS));
        if (remember) await click(remember);
      }
      last ??= (f.password ?? f.username ?? f.account)!.field;

      // Never submit with a visible password box left empty: a blank password can count as a failed sign-in.
      if (!f.password && (await firstEmptyPassword(page))) return "form_not_found";
      const next = await nextButton(page, frame, last, selectors.submit);
      if (next === "missing") return "form_not_found";
      const target = last;
      const submitWait = f.password ? settleMs : stepWaitMs;
      const changed = await afterAction(() => (next ? click(next) : target.press("Enter")), submitWait);
      if (f.password) submitted = true; // from here on, nothing is typed: a later text box could be a security question
      else if (!changed) return "form_not_found";
    }
    if (!submitted) return "form_not_found";

    // 3. "Stay signed in?"
    const stay = await findButton(page, whole(STAY_SIGNED_IN_WORDS));
    if (stay) await afterAction(() => click(stay), settleMs);

    // 4. What the page says now.
    const text = (await Promise.all(page.frames().map((fr) => fr.evaluate(() => document.body?.innerText ?? "").catch(() => "")))).join("\n");
    const decided = decideAfterSubmit({
      challengeVisible: await challengeVisible(page),
      codeFieldVisible: await codeFieldVisible(page, selectors),
      secondCheckText: SECOND_CHECK.test(text),
      lockedText: LOCKED.test(text),
      passwordFieldVisible: !!(await firstVisible(page, 'input[type="password"]')),
      onLoginPage: onLoginPage(page.url(), request.loginUrl),
      pageClass: await classifyHere(request.loginUrl),
    });
    if (decided !== "ok") return decided;
  }

  // 5. Confirm on a page that needs the login. Anything but ok there is not proof the password is wrong.
  try {
    status = (await page.goto(request.checkUrl, { timeout: 20_000, waitUntil: "load" }))?.status() ?? null;
  } catch {
    return "unknown";
  }
  return (await classifyHere(request.checkUrl)) === "ok" ? "ok" : "unknown";
}

async function firstEmptyPassword(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const el of await frame.locator('input[type="password"]').all().catch(() => [])) {
      if ((await el.isVisible().catch(() => false)) && (await el.inputValue().catch(() => "")) === "") return true;
    }
  }
  return false;
}

async function findCheckbox(frame: Frame, words: RegExp): Promise<Locator | null> {
  for (const el of await frame.getByRole("checkbox", { name: words }).all().catch(() => [])) {
    if ((await el.isVisible().catch(() => false)) && !(await el.isChecked().catch(() => true))) return el;
  }
  return null;
}

/** The step's next button: the override, the form's submit button, a Next/Continue/Sign in button, or null for Enter. */
async function nextButton(page: Page, frame: Frame, field: Locator, override: string | undefined): Promise<Locator | "missing" | null> {
  if (override) return (await firstVisible(page, override)) ?? "missing";
  const visible = async (all: Locator) => {
    for (const el of await all.all().catch(() => [])) if (await el.isVisible().catch(() => false)) return el;
    return null;
  };
  const submit = "button[type=submit], input[type=submit]";
  const form = field.locator("xpath=ancestor::form[1]");
  if ((await form.count().catch(() => 0)) > 0) {
    const inForm = await visible(form.locator(submit));
    if (inForm) return inForm;
  }
  const named = whole(NEXT_WORDS);
  for (const role of ["button", "link"] as const) {
    const el = await visible(frame.getByRole(role, { name: named }));
    if (el) return el;
  }
  return findButton(page, named);
}
