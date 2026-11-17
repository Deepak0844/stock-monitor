// Automatic supplier login: the step loop that finds and fills a login form, and the rules that read the page after it.
// Runs on a page of the supplier's persistent profile. The username and password are typed into the page and nowhere else.
import type { Frame, Locator, Page } from "playwright";
import { classifyPage, type LoginSelectors, type PageClass, type SessionState } from "@stock-monitor/supplier-session";
import { CHALLENGE_WIDGET, MAX_TEXT } from "./verify.js";

export type LoginResult = "ok" | "captcha" | "code_required" | "wrong_password" | "account_locked" | "blocked" | "form_not_found" | "unreachable" | "unknown";
export type LoginRequest = { loginUrl: string; checkUrl: string; username: string; password: string; account?: string; stealth: boolean; selectors?: LoginSelectors; loggedInMarker?: string };
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

/** How long a submit may take to leave the page before it is sent once more another way. */
const SEND_WAIT_MS = 2000;

export type StepOptions = { settleMs: number; stepWaitMs?: number; maxSteps?: number };

/**
 * Logs in on `page`, which is already in the supplier's profile: open the login page, run the step loop, read the page after
 * the password, confirm on `checkUrl`. Returns only the result; the caller reads the session when it is `ok`.
 */
export async function runLogin(page: Page, request: LoginRequest, { settleMs, stepWaitMs = 15_000, maxSteps = 5 }: StepOptions): Promise<LoginResult> {
  const selectors = request.selectors ?? {};
  let status: number | null = null;
  /** Every frame navigation, in order: what the step and settle waits look for. */
  const navigated: Frame[] = [];
  page.on("framenavigated", (frame) => void navigated.push(frame));
  /** Every request a frame made, in order: what tells a submit that left the page from one that never fired. */
  const requests: { frame: Frame; nav: boolean; method: string; type: string; url: string }[] = [];
  page.on("request", (r) => {
    try {
      requests.push({ frame: r.frame(), nav: r.isNavigationRequest(), method: r.method(), type: r.resourceType(), url: r.url() });
    } catch {
      // a service worker's request has no frame
    }
  });
  const fromForm = (from: number, form: Frame) => requests.slice(from).filter((q) => q.frame === page.mainFrame() || q.frame === form);
  /**
   * The login left the page: the main or form frame navigated, or posted or fetched to the login page's own site. A beacon or
   * an analytics call to another site is not a login.
   */
  const sentSince = (from: number, form: Frame, site: string) =>
    fromForm(from, form).some(
      (q) => q.nav || ((q.method === "POST" || q.type === "fetch" || q.type === "xhr") && q.type !== "ping" && q.type !== "beacon" && siteOf(q.url) === site),
    );
  page.on("response", (r) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status();
  });

  const signature = async (frames = page.frames()) => {
    const parts: string[] = [];
    for (const frame of frames) {
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
  /**
   * Waits until a frame navigates or the visible fields change. false when nothing changed in time. With `form`, only the
   * main frame or the form's frame navigating, or the fields of the form's frame changing, count: a tracking frame loading
   * while the supplier still answers is not the next step.
   */
  const waitForChange = async (before: string, navsBefore: number, ms: number, form?: Frame) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const moved = form ? navigated.slice(navsBefore).some((fr) => fr === page.mainFrame() || fr === form) : navigated.length > navsBefore;
      if (moved || (await signature(form ? [form] : undefined)) !== before) {
        await page.waitForLoadState("load", { timeout: Math.max(1, end - Date.now()) }).catch(() => {});
        return true;
      }
      await page.waitForTimeout(250);
    }
    return false;
  };
  const afterAction = async (action: () => Promise<void>, ms: number, form?: Frame) => {
    const before = await signature(form ? [form] : undefined);
    const navsBefore = navigated.length;
    await action();
    return waitForChange(before, navsBefore, ms, form);
  };

  let consentUsed = false;
  /**
   * A click that, once per login, clears a cookie banner or popup that covers its target. It never waits for the page it
   * opens: a slow supplier would outlast the click's timeout. The step and settle waits after it do that waiting.
   */
  const click = async (target: Locator) => {
    try {
      await target.click({ timeout: 3000, noWaitAfter: true });
    } catch (error) {
      if (consentUsed || !/intercepts pointer events/i.test(error instanceof Error ? error.message : "")) throw error;
      consentUsed = true;
      const consent = await findButton(page, whole(CONSENT_WORDS));
      if (!consent) throw error;
      await consent.click({ timeout: 3000, noWaitAfter: true });
      await target.click({ timeout: 3000, noWaitAfter: true });
    }
  };

  // The logged-in marker counts for "already logged in?" and the final confirmation, not for the page right after the
  // submit: a landing page without it must not stop a login that worked.
  const classifyHere = async (requestedUrl: string, useMarker = false) => {
    const seen = await page.evaluate(() => ({ title: document.title, text: (document.body?.innerText ?? "").slice(0, 20_000) })).catch(() => ({ title: "", text: "" }));
    return classifyPage({
      requestedUrl,
      loginUrl: request.loginUrl,
      ...(useMarker && request.loggedInMarker ? { loggedInMarker: request.loggedInMarker } : {}),
      page: { finalUrl: page.url(), status, title: seen.title, text: seen.text.slice(0, MAX_TEXT), hasPasswordField: !!(await firstVisible(page, 'input[type="password"]')), hasChallengeWidget: await challengeVisible(page) },
    });
  };
  /**
   * Waits, up to `settleMs` from `since.at`, for the page after the password to settle: the main frame or the form's frame
   * navigated and loaded, or the password box left the login page. A tracking frame or a field changing is not enough: the
   * supplier may still be answering, and the old form is no proof of a wrong password.
   */
  const settle = async (since: { at: number; navs: number; frame: Frame }) => {
    const end = since.at + settleMs;
    while (Date.now() < end) {
      const moved = navigated.slice(since.navs).find((fr) => fr === page.mainFrame() || fr === since.frame);
      if (moved) {
        await moved.waitForLoadState("load", { timeout: Math.max(1, end - Date.now()) }).catch(() => {});
        await page.waitForLoadState("load", { timeout: Math.max(1, end - Date.now()) }).catch(() => {});
        return;
      }
      if (!(await firstVisible(page, 'input[type="password"]')) || !onLoginPage(page.url(), request.loginUrl)) return;
      await page.waitForTimeout(250);
    }
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
  let first = await classifyHere(request.loginUrl, true);
  if (first === "unreachable") return "unreachable";
  if (await challengeVisible(page)) return "captcha";
  // A "checking your browser" page that passes by itself. The classifier calls it captcha (its words) or blocked.
  if ((first === "captcha" || first === "blocked") && !(await anyFormVisible())) {
    await waitForChange(await signature(), navigated.length, stepWaitMs);
    first = await classifyHere(request.loginUrl, true);
    if ((first === "captcha" || first === "blocked") && !(await anyFormVisible())) return (await challengeVisible(page)) ? "captcha" : "blocked";
  }

  // 2. The step loop, unless the profile is still logged in.
  if (first !== "ok") {
    let opened = false;
    let submitted = false;
    let typedUsername = false;
    let typedAccount = false;
    let sent = { at: 0, navs: 0, frame: page.mainFrame() };
    for (let step = 0; step < maxSteps && !submitted; step++) {
      if (await challengeVisible(page)) return "captcha";
      const f = await findFields(page, selectors);
      // A code box counts only on a step with no username or password box: a login form can sit next to a shop's other boxes.
      if (f.code && !f.username && !f.password) return "code_required";
      // The username step, still on screen after its Next: the supplier is still answering. Never click Next again.
      if (typedUsername && f.username && !f.username.empty && !f.password) {
        const form = f.username.frame;
        if (!(await waitForChange(await signature([form]), navigated.length, stepWaitMs, form))) return "form_not_found";
        continue;
      }

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
      if (f.password) sent = { at: Date.now(), navs: navigated.length, frame };
      const requestsBefore = requests.length;
      const site = siteOf(frame.url());
      const password = f.password?.field;
      // Did the send start at all? Listeners for the submit event, the click at the button, or Enter in the password box.
      if (password) await watchSubmit(password, next).catch(() => {});
      const changed = await afterAction(async () => {
        await (next ? click(next) : target.press("Enter", { noWaitAfter: true }));
        if (!password) return;
        // A submit that never happened (a first click lost on a window that just opened) is sent once more, another way.
        // Only when nothing started: no submit event and no request of any frame or kind within the wait, and then only if the
        // page did not cancel the click and the button is a real submit button (see resubmit). A login doing slow work
        // first (a token fetch, a captcha frame, hashing) has started, and sending it again would send the password twice.
        const happened = async () => requests.length > requestsBefore || (await submitFired(frame));
        const end = Date.now() + SEND_WAIT_MS;
        while (Date.now() < end && !(await happened())) await page.waitForTimeout(100);
        if (await happened()) return;
        await resubmit(password, next);
      }, submitWait, f.password ? undefined : frame);
      // Too many requests: the supplier is busy, not refusing the login.
      if (status === 429) return "unreachable";
      // Nothing was sent: the page is not the supplier's answer, so it says nothing about the password. Another frame
      // changing first (a tracking frame) is no answer either: the login may still be on its way, up to the settle time.
      if (password) {
        while (!sentSince(requestsBefore, frame, site) && Date.now() < sent.at + settleMs) await page.waitForTimeout(100);
        if (!sentSince(requestsBefore, frame, site)) return "unknown";
      }
      if (f.password) submitted = true; // from here on, nothing is typed: a later text box could be a security question
      else if (!changed) return "form_not_found";
    }
    if (!submitted) return "form_not_found";

    // 3. "Stay signed in?"
    const stay = await findButton(page, whole(STAY_SIGNED_IN_WORDS));
    if (stay) {
      sent = { at: Date.now(), navs: navigated.length, frame: page.mainFrame() };
      await afterAction(() => click(stay), settleMs);
    }

    // 4. What the page says now. A wrong password only once the page has settled, read again: it pauses automatic login.
    const facts = async (): Promise<AfterSubmitFacts> => {
      const text = (await Promise.all(page.frames().map((fr) => fr.evaluate(() => document.body?.innerText ?? "").catch(() => "")))).join("\n");
      return {
        challengeVisible: await challengeVisible(page),
        codeFieldVisible: await codeFieldVisible(page, selectors),
        secondCheckText: SECOND_CHECK.test(text),
        lockedText: LOCKED.test(text),
        passwordFieldVisible: !!(await firstVisible(page, 'input[type="password"]')),
        onLoginPage: onLoginPage(page.url(), request.loginUrl),
        pageClass: await classifyHere(request.loginUrl),
      };
    };
    let decided = decideAfterSubmit(await facts());
    if (decided === "wrong_password") {
      await settle(sent);
      decided = decideAfterSubmit(await facts());
    }
    if (decided !== "ok") return decided;
  }

  // 5. Confirm on a page that needs the login. Anything but ok there is not proof the password is wrong.
  try {
    status = (await page.goto(request.checkUrl, { timeout: 20_000, waitUntil: "load" }))?.status() ?? null;
  } catch {
    return "unknown";
  }
  return (await classifyHere(request.checkUrl, true)) === "ok" ? "ok" : "unknown";
}

/** The site of an address: its host without the subdomains (two labels, three for a country's "co.uk"-style suffix). */
function siteOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
    const labels = host.split(".");
    const keep = labels.length > 2 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3 ? 3 : 2;
    return labels.slice(-keep).join(".");
  } catch {
    return "";
  }
}

const WATCH = "__stockMonitorSubmitWatch";
type Watch = { submit: boolean; reached: boolean; seen: boolean; prevented: boolean };

/**
 * Arms listeners on the window that tell what happened to the password's send: the form's submit event, the click reaching the
 * button (or Enter the password box), and, from a bubble-phase listener registered after the page's own handlers, whether the
 * page cancelled that click or Enter. Once the page has taken over, the password must never be sent again.
 */
async function watchSubmit(password: Locator, next: Locator | null): Promise<void> {
  const button = next ? await next.elementHandle({ timeout: 1000 }).catch(() => null) : null;
  await password.evaluate(
    (el, { button, key }) => {
      const w = window as unknown as Record<string, Watch>;
      const st: Watch = (w[key] = { submit: false, reached: false, seen: false, prevented: false });
      window.addEventListener("submit", () => void (st.submit = true), { capture: true });
      const hit = (e: Event) => (button ? button.contains(e.target as Node) : e.target === el && (e as KeyboardEvent).key === "Enter");
      const type = button ? "click" : "keydown";
      window.addEventListener(type, (e) => hit(e) && void (st.reached = true), { capture: true });
      window.addEventListener(type, (e) => hit(e) && void ((st.seen = true), (st.prevented = e.defaultPrevented)));
    },
    { button, key: WATCH },
  );
}

/** Whether the send started by itself: a submit event fired. A frame that cannot answer (it navigated away) counts as yes. */
async function submitFired(frame: Frame): Promise<boolean> {
  return frame.evaluate((key) => (window as unknown as Record<string, Watch>)[key]?.submit === true, WATCH).catch(() => true);
}

/**
 * Sends the password's form once more, but only when the browser ignored a click the page left alone: the target is a real submit
 * button of that form (or Enter was used on a form), the page did not cancel the click, the form is valid. Otherwise nothing is sent.
 */
async function resubmit(password: Locator, next: Locator | null): Promise<void> {
  const button = next ? await next.elementHandle({ timeout: 1000 }).catch(() => null) : null;
  await password
    .evaluate(
      (el, { button, key }) => {
        const st = (window as unknown as Record<string, Watch>)[key];
        const form = (el as HTMLInputElement).form;
        if (!form || !st || st.submit) return;
        // Reached but never seen in the bubble phase: the page stopped it. Seen and cancelled: the page took over.
        if (st.reached && (!st.seen || st.prevented)) return;
        const b = button as HTMLButtonElement | HTMLInputElement | null;
        if (b && !(b.form === form && (b.type === "submit" || b.type === "image"))) return;
        if (!form.checkValidity()) return;
        form.requestSubmit(b ?? undefined); // the button's name and value go with it, as some servers need
      },
      { button, key: WATCH },
    )
    .catch(() => {});
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
