// Automatic supplier login: the step loop that finds and fills a login form, and the rules that read the page after it.
// Runs on a page of the supplier's persistent profile. The username and password are typed into the page and nowhere else.
import type { Frame, Locator, Page } from "playwright";
import { explainPage, type LoginSelectors, type PageClass, type SessionState } from "@stock-monitor/supplier-session";
import { guessOpener, guessSubmit } from "./login-guess.js";
import { NAME_SHIM } from "./page-shim.js";
import { CHALLENGE_WIDGET, MAX_TEXT } from "./verify.js";

export type LoginResult = "ok" | "captcha" | "code_required" | "wrong_password" | "account_locked" | "blocked" | "form_not_found" | "unreachable" | "unknown";
export type LoginRequest = { loginUrl: string; checkUrl: string; username: string; password: string; account?: string; stealth: boolean; selectors?: LoginSelectors; loggedInMarker?: string };
/** `state` only when `result` is `ok`. `why` only when the login stopped with form_not_found or unknown: a fixed reason code naming the rule that stopped it, never page content or anything typed. */
export type LoginOutcome = { result: LoginResult; state?: SessionState; why?: string };
export type AfterSubmitFacts = {
  challengeVisible: boolean;
  /** A captcha provider's frame says a second-check word ("Verify"): it has loaded a challenge, shown or not yet. */
  captchaFrameText: boolean;
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
export const CONSENT_WORDS = ["Accept", "Accept all", "Allow all", "Agree", "OK", "No thanks", "Close", "×"];
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
  if (notOk && f.captchaFrameText) return "captcha";
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

type Input = { index: number; mark: string; visible: boolean; empty: boolean; password: boolean; usernameLike: boolean; account: boolean; checkbox: boolean; code: boolean; maxLength: number };
export type Found = { frame: Frame; field: Locator; empty: boolean } | null;
/** `code`: a visible one-time-code box in the same frame. It is never taken for the username. */
export type Fields = { account: Found; username: Found; password: Found; code: boolean };

/**
 * Each box the login reads is marked once with a number of its own, and every later look finds it by that mark. A box found by its
 * position ("the 21st input") points at another box as soon as the page adds or removes one in front of it (a search or suggestion
 * widget does), and the typing, the password included, would land there.
 */
const MARK_ATTR = "data-sm-box";

/** Every input in a frame, in document order (open shadow roots included), with what the rules need to know. In-page. */
async function inputsOf(frame: Frame, overrides: LoginSelectors): Promise<Input[]> {
  return frame
    .locator("input")
    .evaluateAll(
      (els, { o, codeWords, notCodeWords, markAttr }) =>
        els.map((node, index) => {
          const el = node as HTMLInputElement;
          let mark = el.getAttribute(markAttr);
          // Only a plain number is ours: a value the page put there itself (or a counter it spoiled) is replaced.
          if (!mark || !/^\d+$/.test(mark)) {
            const seen = window as unknown as { __smBox?: unknown };
            seen.__smBox = (typeof seen.__smBox === "number" && Number.isFinite(seen.__smBox) ? seen.__smBox : 0) + 1;
            mark = String(seen.__smBox);
            el.setAttribute(markAttr, mark);
          }
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const visible = box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1 && !el.readOnly && !el.disabled;
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
          const codeLike = !password && (autocomplete === "one-time-code" || (new RegExp(codeWords, "i").test(says) && !new RegExp(notCodeWords, "i").test(says)));
          // A code box that already holds text (a popup's coupon code) is not one the supplier is asking us to fill, nor a username box.
          const code = codeLike && el.value === "";
          return {
            index,
            mark,
            visible,
            empty: el.value === "",
            password,
            usernameLike: o.username ? is(o.username) : !codeLike && (["email", "text", "tel"].includes(type) || autocomplete === "username"),
            account,
            checkbox: type === "checkbox",
            code,
            maxLength: el.maxLength,
          };
        }),
      { o: overrides, codeWords: CODE_WORDS.source, notCodeWords: NOT_CODE_WORDS.source, markAttr: MARK_ATTR },
    )
    .catch(() => []);
}

/** The fields of this step, searched in every frame, visible ones only. The account field is never taken for the username. */
export async function findFields(page: Page, overrides: LoginSelectors): Promise<Fields> {
  const none: Fields = { account: null, username: null, password: null, code: false };
  for (const frame of page.frames()) {
    const inputs = (await inputsOf(frame, overrides)).filter((i) => i.visible && !i.checkbox);
    const at = (i: Input | undefined): Found => (i ? { frame, field: frame.locator(`input[${MARK_ATTR}="${i.mark}"]`), empty: i.empty } : null);
    const password = inputs.find((i) => i.password);
    const account = inputs.find((i) => i.account && !i.password);
    const candidates = inputs.filter((i) => i.usernameLike && !i.password && !i.account);
    const username = password ? candidates.filter((i) => i.index < password.index).at(-1) : candidates[0];
    const code = inputs.some((i) => i.code);
    if (password || username || account || code) return { account: at(account), username: at(username), password: at(password), code };
  }
  return none;
}

/**
 * Counts and one yes/no only, never values, page text, the host, the query or the path (a path can carry a username or a token):
 * what the login saw when it found no form. `samepath` is whether the page is still at the login address.
 * `locator` is a plain count of input elements; `evalfailed` counts frames where reading them in detail failed (the reading
 * swallows its errors, so a page it cannot read looks empty).
 */
async function sawCounts(page: Page, overrides: LoginSelectors, loginUrl: string): Promise<string> {
  let frames = 0;
  let inputs = 0;
  let located = 0;
  let evalFailed = 0;
  let visible = 0;
  let passwords = 0;
  let usernames = 0;
  for (const frame of page.frames()) {
    frames++;
    const here = await frame.locator("input").count().catch(() => 0);
    const rows = await inputsOf(frame, overrides);
    located += here;
    inputs += rows.length;
    if (here > 0 && rows.length === 0) evalFailed++;
    for (const r of rows.filter((i) => i.visible && !i.checkbox)) {
      visible++;
      if (r.password) passwords++;
      if (r.usernameLike) usernames++;
    }
  }
  let samePath = "no";
  try {
    const here = new URL(page.url()).pathname.replace(/\/$/, "");
    if (here === new URL(loginUrl).pathname.replace(/\/$/, "")) samePath = "yes";
  } catch {
    // an address that is not a URL says nothing
  }
  return `frames=${frames} inputs=${inputs} locator=${located} evalfailed=${evalFailed} visible=${visible} password=${passwords} username=${usernames} samepath=${samePath}`;
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

/**
 * A button that closes a popup. Never a submit control, and never a button inside a form that has a password box: with
 * words as short as "OK" that would be a form's own send button, and clicking it would send a password a second time.
 */
async function findConsentButton(page: Page): Promise<Locator | null> {
  const words = whole(CONSENT_WORDS);
  for (const frame of page.frames()) {
    for (const role of ["button", "link"] as const) {
      for (const el of await frame.getByRole(role, { name: words }).all().catch(() => [])) {
        if (!(await el.isVisible().catch(() => false))) continue;
        const unsafe = await el
          .evaluate((node) => (node as HTMLInputElement | HTMLButtonElement).type === "submit" || !!node.closest("form")?.querySelector('input[type="password"]'))
          .catch(() => true);
        if (!unsafe) return el;
      }
    }
  }
  return null;
}

/**
 * The icon that closes a promo popup when nothing on it is named "Close" or "OK": an element called close by its label,
 * title, class or id. Used once, only when the page showed no login box. Never a control of a form with a password box.
 */
async function findPopupCloseIcon(page: Page): Promise<Locator | null> {
  const selector = '[aria-label*="close" i], [title*="close" i], [class*="close" i], [id*="close" i], [data-dismiss], [data-bs-dismiss]';
  for (const frame of page.frames()) {
    for (const el of await frame.locator(selector).all().catch(() => [])) {
      if (!(await el.isVisible().catch(() => false))) continue;
      const unsafe = await el.evaluate((node) => !!node.closest("form")?.querySelector('input[type="password"]')).catch(() => true);
      if (!unsafe) return el;
    }
  }
  return null;
}

/** The owner's opener, else one that says exactly Sign in, Log in, Login or My account, else one guessed from what it says. */
export async function findOpener(page: Page, override?: string): Promise<Locator | null> {
  if (override) return firstVisible(page, override);
  return (await findButton(page, whole(OPEN_WORDS))) ?? guessOpener(page);
}

async function firstVisible(page: Page, selector: string): Promise<Locator | null> {
  for (const frame of page.frames()) {
    for (const el of await frame.locator(selector).all().catch(() => [])) if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

/**
 * Where an emailed code goes: the first visible, empty code box, and when it takes one character, the one-character boxes
 * after it (a code split one digit per box).
 */
async function codeBoxes(page: Page, overrides: LoginSelectors): Promise<{ frame: Frame; boxes: Locator[] } | null> {
  for (const frame of page.frames()) {
    const inputs = (await inputsOf(frame, overrides)).filter((i) => i.visible && !i.checkbox && !i.password);
    const first = inputs.findIndex((i) => i.code);
    if (first < 0) continue;
    const at = (i: Input) => frame.locator(`input[${MARK_ATTR}="${i.mark}"]`);
    if (inputs[first]!.maxLength !== 1) return { frame, boxes: [at(inputs[first]!)] };
    const run: Input[] = [];
    for (const i of inputs.slice(first)) {
      if (i.maxLength !== 1 || !i.empty) break;
      run.push(i);
    }
    return { frame, boxes: run.map(at) };
  }
  return null;
}

/** A visible one-time-code box in any frame. */
async function codeFieldVisible(page: Page, overrides: LoginSelectors): Promise<boolean> {
  for (const frame of page.frames()) if ((await inputsOf(frame, overrides)).some((i) => i.visible && i.code)) return true;
  return false;
}

/** Captcha providers' frames, by address: the same providers as CHALLENGE_WIDGET. The name is what the log says. */
const CAPTCHA_FRAMES: [string, RegExp][] = [["hcaptcha", /hcaptcha\.com\/captcha/], ["recaptcha", /recaptcha\/api2/], ["turnstile", /challenges\.cloudflare\.com/]];
type FrameText = { text: string; captcha?: string; shown: boolean };
/** Every frame's text, its captcha provider if it is one, and whether anyone can see it (the main page always). */
async function frameTexts(page: Page): Promise<FrameText[]> {
  return Promise.all(
    page.frames().map(async (fr) => {
      const text = await fr.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      const el = fr === page.mainFrame() ? null : await fr.frameElement().catch(() => null);
      // Same size rule as a challenge widget: a 1 px or hidden frame (tracking, a preloaded widget) is seen by no one.
      const shown = !el || (await el.evaluate((e: Element) => {
        const box = e.getBoundingClientRect();
        const style = getComputedStyle(e);
        return box.width >= 50 && box.height >= 30 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1;
      }).catch(() => false));
      return { text, captcha: CAPTCHA_FRAMES.find(([, at]) => at.test(fr.url()))?.[0], shown };
    }),
  );
}

export async function challengeVisible(page: Page): Promise<boolean> {
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
/** Typing takes as long as the text is long: the timeout grows with it, but a stuck box still fails. */
const type = (field: Locator, value: string) => field.pressSequentially(value, { delay: typingDelay(), timeout: 5000 + value.length * 200 });

/** Whether the box holds exactly `want`; only the username box may be trimmed (an email box does). A yes or no: the value never leaves the page. */
const holds = (field: Locator, want: string, trimOk = false, mustBe?: string) =>
  field
    .evaluate((el, { w, trimOk, mustBe }) => {
      const box = el as HTMLInputElement;
      // A password box that has stopped being one (a page turning it into a text box) is not the box that was found.
      if (mustBe && box.type !== mustBe) return false;
      return box.value === w || (trimOk && box.type === "email" && box.value === w.trim());
    }, { w: want, trimOk, mustBe }, { timeout: 5000 })
    .catch(() => false);

/**
 * How a box differs from what was typed in it, as lengths and yes/no flags only: never the text, never the box's content. It
 * goes into the reason code when typing fails, so the owner can see whether a page cuts, rewrites or locks the box. For a
 * password only a shorter, longer or same-length hint is given: its length and its capitals are not for a log.
 */
const boxFacts = (field: Locator, want: string, secret: boolean) =>
  field
    .evaluate((el, { w, secret }) => {
      const box = el as HTMLInputElement;
      if (secret) {
        const rel = box.value.length < w.length ? "shorter" : box.value.length > w.length ? "longer" : "same-length";
        return `rel=${rel} type=${box.type} maxlength=${box.maxLength} focus=${box.ownerDocument.activeElement === box} readonly=${box.readOnly || box.disabled}`;
      }
      // Where the box first differs, as a position only: says whether the first key, a middle one or the end went missing.
      let firstdiff = 0;
      while (firstdiff < w.length && box.value[firstdiff] === w[firstdiff]) firstdiff++;
      return `typed=${w.length} box=${box.value.length} firstdiff=${firstdiff} samecase=${box.value.toLowerCase() === w.toLowerCase()} maxlength=${box.maxLength} focus=${box.ownerDocument.activeElement === box} readonly=${box.readOnly || box.disabled}`;
    }, { w: want, secret }, { timeout: 3000 })
    .catch(() => "box unreadable");

/**
 * Types `value` and checks, inside the page, that the box holds exactly it (an email box may trim): a browser that has just
 * opened can swallow the first keystrokes. Nothing is submitted yet, so a short box is cleared and typed again, twice at most.
 * Only a yes or no leaves the page, never the value. false: the box still differs, so nothing may be submitted.
 */
async function typeVerified(
  page: Page,
  field: Locator,
  value: string,
  { trimOk = false, mustBe, secret = false, report }: { trimOk?: boolean; mustBe?: string; secret?: boolean; report?: (facts: string) => void } = {},
): Promise<boolean> {
  await page.bringToFront().catch(() => {});
  // Wait (3 s at most) for the page to be loaded and the box to hold the focus before the first keystroke.
  const ready = Date.now() + 3000;
  await field.focus({ timeout: 3000 }).catch(() => {});
  while (Date.now() < ready) {
    const ok = await field.evaluate((el) => el.ownerDocument.readyState === "complete" && el.ownerDocument.activeElement === el).catch(() => false);
    if (ok) break;
    await field.focus({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(100);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    // An error here could carry the typed text: it is dropped, and the box is simply checked.
    try {
      await field.fill("", { timeout: 5000 });
      // A box that lost keys may still be settling, as a window that has just opened is: give it a moment before typing again.
      if (attempt > 0) await page.waitForTimeout(RETYPE_SETTLE_MS);
      await type(field, value);
    } catch {
      // checked below
    }
    if (await holds(field, value, trimOk, mustBe)) return true;
  }
  report?.(await boxFacts(field, value, secret));
  return false;
}

/** The pause between clearing a box that lost keys and typing it again. */
export const RETYPE_SETTLE_MS = 1000;

/** How long a step waits for a page that is still loading to show a box, a choice button or a puzzle. */
export const FORM_WAIT_MS = 10_000;

/** `onWhy` hears a fixed reason code whenever the login stops with form_not_found or unknown: which rule stopped it. Never page content, never anything typed. */
export type StepOptions = {
  settleMs: number;
  stepWaitMs?: number;
  maxSteps?: number;
  deadlineMs?: number;
  formWaitMs?: number;
  onWhy?: (why: string) => void;
  /** When set, a code box is not the end: the login asks for the emailed code, types it once and goes on. null means none came. */
  awaitCode?: () => Promise<string | null>;
};

/**
 * Logs in on `page`, which is already in the supplier's profile: open the login page, run the step loop, read the page after
 * the password, confirm on `checkUrl`. Returns only the result; the caller reads the session when it is `ok`.
 */
export async function runLogin(page: Page, request: LoginRequest, { settleMs, stepWaitMs = 15_000, maxSteps = 5, deadlineMs = 150_000, formWaitMs = FORM_WAIT_MS, onWhy, awaitCode }: StepOptions): Promise<LoginResult> {
  const selectors = request.selectors ?? {};
  /** What the password box must still be after it is typed in. Not when the owner named it by hand: a show-password box is text. */
  const passwordType = selectors.password ? undefined : "password";
  /** Past this, nothing more is typed or pressed. Never checked after the submit press: from there the login only waits and decides. */
  const deadline = Date.now() + deadlineMs;
  const expired = () => Date.now() > deadline;
  /** The way out with form_not_found or unknown: it names the rule that stopped the login, as a fixed code. */
  const stop = (result: "form_not_found" | "unknown", why: string): LoginResult => {
    onWhy?.(why);
    return result;
  };
  const notFound = (why: string) => stop("form_not_found", why);
  const unclear = (why: string) => stop("unknown", why);
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
  const stale = Symbol("a typed box changed");
  const click = async (target: Locator, verify?: () => Promise<boolean>) => {
    try {
      await target.click({ timeout: 3000, noWaitAfter: true });
    } catch (error) {
      if (consentUsed || !/intercepts pointer events/i.test(error instanceof Error ? error.message : "")) throw error;
      consentUsed = true;
      const consent = await findConsentButton(page);
      if (!consent) throw error;
      await consent.click({ timeout: 3000, noWaitAfter: true });
      // Dismissing a banner can re-render the form: the typed boxes are checked again before the second, unchecked click.
      if (verify && !(await verify())) throw stale;
      await target.click({ timeout: 3000, noWaitAfter: true });
    }
  };

  // The logged-in marker counts for "already logged in?" and the final confirmation, not for the page right after the
  // submit: a landing page without it must not stop a login that worked.
  const classifyHere = async (requestedUrl: string, useMarker = false) => (await explainHere(requestedUrl, useMarker)).result;
  /** The page's class and the rule that decided it, a fixed code for the log. */
  const explainHere = async (requestedUrl: string, useMarker = false) => {
    const seen = await page.evaluate(() => ({ title: document.title, text: (document.body?.innerText ?? "").slice(0, 20_000) })).catch(() => ({ title: "", text: "" }));
    return explainPage({
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
  /**
   * Gives a page that is still loading time to show what this step needs: waits (bounded) for the load, then polls until a
   * username, password, account or code box, a "Use password" button, the opener or a puzzle is visible. Returns at once when one is
   * already there. Never waits past `formWaitMs` or the overall deadline; a page that never loads is not an error here.
   */
  const waitForForm = async (opened: boolean) => {
    const end = Math.min(Date.now() + formWaitMs, deadline);
    await page.waitForLoadState("load", { timeout: Math.max(1, Math.min(10_000, end - Date.now())) }).catch(() => {});
    for (;;) {
      const f = await findFields(page, selectors);
      if (f.username || f.password || f.account || f.code) return;
      if ((await challengeVisible(page)) || (await findButton(page, whole(USE_PASSWORD_WORDS)))) return;
      // The opener of a login that stays hidden until clicked is on screen: nothing more to wait for, the step opens it.
      if (!opened && (await findOpener(page, selectors.open))) return;
      if (Date.now() >= end) return;
      await page.waitForTimeout(Math.min(250, Math.max(1, end - Date.now())));
    }
  };
  const anyFormVisible = async () => {
    const f = await findFields(page, selectors);
    return !!(f.password || f.username || f.account);
  };

  // 1. The login page. Its scripts have named inner functions, and the container's tsx wraps those in a helper the page does not
  // have: without the shim every page read fails, and a read that swallows its errors sees a page with no boxes at all.
  await page.addInitScript(NAME_SHIM).catch(() => {});
  // A supplier's server can answer with an error for a moment: the page is asked for once more, after a short pause. A 429 is
  // not retried (that is the supplier asking us to slow down).
  for (let attempt = 0; attempt < 2; attempt++) {
    status = null;
    try {
      status = (await page.goto(request.loginUrl, { timeout: 20_000, waitUntil: "load" }))?.status() ?? null;
    } catch {
      // no answer at all
    }
    if (status !== null && status < 500) break;
    if (attempt === 0 && !expired()) await page.waitForTimeout(3000);
  }
  if (status === null || status >= 500 || status === 429) {
    onWhy?.(`login_page_status=${status ?? "none"}`);
    return "unreachable";
  }
  // goto already waited for "load", but a script can still be building the page: look again only once it settles. A page with too
  // little text is never ok, so a half-loaded page cannot pass for a logged-in one; the box wait below covers the rest.
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  let first = await classifyHere(request.loginUrl, true);
  if (first === "unreachable") return "unreachable";
  if (await challengeVisible(page)) return "captcha";
  // A "checking your browser" page that passes by itself. The classifier calls it captcha (its words) or blocked.
  if ((first === "captcha" || first === "blocked") && !(await anyFormVisible())) {
    await waitForChange(await signature(), navigated.length, stepWaitMs);
    first = await classifyHere(request.loginUrl, true);
    if ((first === "captcha" || first === "blocked") && !(await anyFormVisible())) return (await challengeVisible(page)) ? "captcha" : "blocked";
  }

  /** Set when the page after the password was too unclear to read: the reason code, kept for the log if the confirm fails too. */
  let unclearAfterSubmit = "";
  // 2. The step loop, unless the profile is still logged in.
  if (first !== "ok") {
    let opened = false;
    let closedIcon = false;
    let submitted = false;
    let typedUsername = false;
    let typedAccount = false;
    /** How a box that would not take the typing differs (lengths and flags only), for the reason code. */
    let typingNote = "";
    let sent = { at: 0, navs: 0, frame: page.mainFrame() };
    /** The emailed code went in. It is typed once: a code page that comes back means the code was not taken. */
    let codeLength = 0;
    /**
     * Asks for the emailed code, types it into the code box (one character per box for a split code), checks it is there and
     * presses the box's button, or Enter. The code is never logged: the reason line says its length only. No deadline: the
     * wait for the email is the caller's, and every step after it is bounded.
     */
    const enterCode = async (): Promise<LoginResult | "sent"> => {
      const code = await awaitCode!();
      if (!code) return "code_required";
      const found = await codeBoxes(page, selectors);
      if (!found || found.boxes.length === 0 || (found.boxes.length > 1 && found.boxes.length < code.length)) return "code_required";
      const parts = found.boxes.length > 1 ? [...code] : [code];
      for (const [i, part] of parts.entries()) {
        if (!(await typeVerified(page, found.boxes[i]!, part, { secret: true, report: (x) => (typingNote = x) }))) return unclear(`code_not_typed ${typingNote}`);
      }
      const last = found.boxes[parts.length - 1]!;
      const next = await nextButton(page, found.frame, last, selectors.submit);
      sent = { at: Date.now(), navs: navigated.length, frame: found.frame };
      await afterAction(() => (next && next !== "missing" ? click(next) : last.press("Enter", { noWaitAfter: true })), settleMs);
      codeLength = code.length;
      return "sent";
    };
    for (let step = 0; step < maxSteps && !submitted; step++) {
      if (expired()) return unclear("deadline");
      if (await challengeVisible(page)) return "captcha";
      let f = await findFields(page, selectors);
      // Nothing to fill yet: the page may still be loading its boxes. Only a page that stays empty goes on to the opener.
      if (!f.username && !f.password && !f.account && !f.code) {
        await waitForForm(opened);
        if (expired()) return unclear("deadline");
        if (await challengeVisible(page)) return "captcha";
        f = await findFields(page, selectors);
      }
      // A code box counts only on a step with no username or password box: a login form can sit next to a shop's other boxes.
      if (f.code && !f.username && !f.password) {
        if (!awaitCode || codeLength) return "code_required";
        const entered = await enterCode();
        if (entered !== "sent") return entered;
        submitted = true;
        continue;
      }
      // The username step, still on screen after its Next: the supplier is still answering. Never click Next again.
      if (typedUsername && f.username && !f.username.empty && !f.password) {
        const form = f.username.frame;
        if (!(await waitForChange(await signature([form]), navigated.length, stepWaitMs, form))) return notFound("username_step_stuck");
        continue;
      }

      if (!f.username && !f.password && !f.account) {
        // A choice screen ("Use password" / "Send me a code"), else the button that opens the login.
        const choice = await findButton(page, whole(USE_PASSWORD_WORDS));
        if (choice) {
          if (!(await afterAction(() => click(choice), stepWaitMs))) return notFound("choice_no_change");
          continue;
        }
        if (opened) {
          // A promo popup may hide the login until it is closed. Its close icon is tried once.
          const icon = closedIcon ? null : await findPopupCloseIcon(page);
          closedIcon = true;
          if (icon && (await icon.click({ timeout: 3000, noWaitAfter: true }).then(() => true, () => false))) continue;
          return notFound(`opener_clicked_no_boxes ${await sawCounts(page, selectors, request.loginUrl)}`);
        }
        opened = true;
        const opener = await findOpener(page, selectors.open);
        if (!opener) return notFound(`no_opener ${await sawCounts(page, selectors, request.loginUrl)}`);
        if (!(await afterAction(() => click(opener), stepWaitMs))) return notFound("opener_no_change");
        continue;
      }

      // An override that is not on the page is never guessed around.
      if (selectors.username && !f.username && !typedUsername) return notFound("username_override_missing");
      if (selectors.account && !f.account && request.account && !typedAccount) return notFound("account_override_missing");
      // A password override that is missing is only fine on a username step of a two-step login, never after it.
      if (selectors.password && !f.password && (!f.username?.empty || typedUsername)) return notFound("password_override_missing");

      let last: Locator | null = null;
      /** The boxes typed in this step and what they must still hold when the button is pressed. */
      const typed: { field: Locator; value: string; mustBe?: string }[] = [];
      const frame = (f.password ?? f.username ?? f.account)!.frame;
      if (f.account?.empty) {
        if (!request.account) return notFound("account_needed"); // the page needs an account number and none is saved
        if (expired()) return unclear("deadline");
        if (!(await typeVerified(page, f.account.field, request.account, { report: (x) => (typingNote = x) }))) return unclear(`account_not_typed ${typingNote}`);
        typed.push({ field: f.account.field, value: request.account });
        typedAccount = true;
        last = f.account.field;
      }
      if (f.username?.empty) {
        if (expired()) return unclear("deadline");
        if (!(await typeVerified(page, f.username.field, request.username, { trimOk: true, report: (x) => (typingNote = x) }))) return unclear(`username_not_typed ${typingNote}`);
        typed.push({ field: f.username.field, value: request.username });
        typedUsername = true;
        last = f.username.field;
      }
      if (f.password) {
        if (expired()) return unclear("deadline");
        if (!(await typeVerified(page, f.password.field, request.password, { mustBe: passwordType, secret: true, report: (x) => (typingNote = x) }))) return unclear(`password_not_typed ${typingNote}`);
        typed.push({ field: f.password.field, value: request.password, mustBe: passwordType });
        last = f.password.field;
        const remember = await findCheckbox(frame, within(REMEMBER_ME_WORDS));
        if (remember) await click(remember);
      }
      last ??= (f.password ?? f.username ?? f.account)!.field;

      // Never submit with a visible password box left empty: a blank password can count as a failed sign-in.
      if (!f.password && (await firstEmptyPassword(page))) return notFound("empty_password_box");
      const next = await nextButton(page, frame, last, selectors.submit);
      if (next === "missing") return notFound("no_submit_button");
      const target = last;
      const submitWait = f.password ? settleMs : stepWaitMs;
      if (f.password) sent = { at: Date.now(), navs: navigated.length, frame };
      const requestsBefore = requests.length;
      const site = siteOf(frame.url());
      const password = f.password?.field;
      if (expired()) return unclear("deadline");
      const verify = async () => {
        for (const t of typed) if (!(await holds(t.field, t.value, t.field === f.username?.field, t.mustBe))) return false;
        return true;
      };
      // A remember-me click, a re-render or a lost focus can change a box: every typed box is checked again right before the press.
      if (!(await verify())) return unclear("box_changed_before_press");
      // A press the page never received sends nothing: the result is unknown, never a second press.
      let changed: boolean;
      try {
        changed = await afterAction(() => (next ? click(next, verify) : target.press("Enter", { noWaitAfter: true })), submitWait, f.password ? undefined : frame);
      } catch (error) {
        if (error === stale) return unclear("box_changed_after_banner");
        throw error;
      }
      // Too many requests: the supplier is busy, not refusing the login.
      if (status === 429) return "unreachable";
      // Nothing was sent: the page is not the supplier's answer, so it says nothing about the password. Another frame
      // changing first (a tracking frame) is no answer either: the login may still be on its way, up to the settle time.
      if (password) {
        while (!sentSince(requestsBefore, frame, site) && Date.now() < sent.at + settleMs) await page.waitForTimeout(100);
        if (!sentSince(requestsBefore, frame, site)) return unclear("nothing_sent");
      }
      if (f.password) submitted = true; // from here on, nothing is typed: a later text box could be a security question
      else if (!changed) return notFound("no_change_after_next");
    }
    if (!submitted) return notFound("steps_used_up");

    // 3. "Stay signed in?"
    const stay = await findButton(page, whole(STAY_SIGNED_IN_WORDS));
    if (stay) {
      sent = { at: Date.now(), navs: navigated.length, frame: page.mainFrame() };
      await afterAction(() => click(stay), settleMs);
    }

    // 4. What the page says now. A wrong password only once the page has settled, read again: it pauses automatic login.
    let frames: FrameText[] = [];
    let pageSignal = "";
    const facts = async (): Promise<AfterSubmitFacts> => {
      frames = await frameTexts(page);
      const after = await explainHere(request.loginUrl);
      pageSignal = after.signal;
      return {
        challengeVisible: await challengeVisible(page),
        captchaFrameText: frames.some((f) => f.captcha && SECOND_CHECK.test(f.text)),
        codeFieldVisible: await codeFieldVisible(page, selectors),
        // A captcha's own "Verify" is no code, and a frame no one can see asks the owner nothing.
        secondCheckText: frames.some((f) => f.shown && !f.captcha && SECOND_CHECK.test(f.text)),
        lockedText: LOCKED.test(frames.map((f) => f.text).join("\n")),
        passwordFieldVisible: !!(await firstVisible(page, 'input[type="password"]')),
        onLoginPage: onLoginPage(page.url(), request.loginUrl),
        pageClass: after.result,
      };
    };
    let seen = await facts();
    let decided = decideAfterSubmit(seen);
    if (decided === "wrong_password") {
      await settle(sent);
      seen = await facts();
      decided = decideAfterSubmit(seen);
    }
    // The page asks for the emailed code: type it once, then read the page again.
    if (decided === "code_required" && awaitCode && !codeLength && seen.codeFieldVisible) {
      const entered = await enterCode();
      if (entered !== "sent") return entered;
      seen = await facts();
      decided = decideAfterSubmit(seen);
    }
    if (decided === "code_required" && codeLength) {
      onWhy?.(`code_not_taken len=${codeLength}`);
      return "code_required";
    }
    // A page too bare to read (one still loading, an in-between page) is no answer: the confirm below decides, so a login that
    // worked is not called failed. A page that still asks for the login is an answer.
    if (decided === "unknown" && seen.pageClass === "unknown") unclearAfterSubmit = `unclear_after_submit page=unknown/${pageSignal} `;
    else if (decided === "unknown") return unclear(`unclear_after_submit page=${seen.pageClass}/${pageSignal}`);
    if (decided === "captcha" && !seen.challengeVisible) onWhy?.(`after_submit captcha_frame=${frames.find((f) => f.captcha && SECOND_CHECK.test(f.text))?.captcha}`);
    if (decided === "code_required") {
      // Which rule said so, from our own fixed word list only: a code-like box, or one of the second-check words in a frame that counts.
      const counted = frames.filter((f) => f.shown && !f.captcha);
      const word = SECOND_CHECK_WORDS.find((w) => counted.some((f) => within([w]).test(f.text))) ?? "none";
      const inMain = frames[0] !== undefined && within(SECOND_CHECK_WORDS).test(frames[0].text);
      onWhy?.(`after_submit code_box=${seen.codeFieldVisible} word=${word} in=${word === "none" ? "none" : inMain ? "main" : "other_frame"} class=${seen.pageClass} loginpage=${seen.onLoginPage} password=${seen.passwordFieldVisible}`);
    }
    if (decided !== "ok" && decided !== "unknown") return decided;
  }

  // 5. Confirm on a page that needs the login. Anything but ok there is not proof the password is wrong.
  try {
    status = (await page.goto(request.checkUrl, { timeout: 20_000, waitUntil: "load" }))?.status() ?? null;
  } catch {
    return unclear(`${unclearAfterSubmit}confirm_page_unreachable`);
  }
  const confirmed = await explainHere(request.checkUrl, true);
  return confirmed.result === "ok" ? "ok" : unclear(`${unclearAfterSubmit}confirm_not_ok page=${confirmed.result}/${confirmed.signal}`);
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
export async function nextButton(page: Page, frame: Frame, field: Locator, override: string | undefined): Promise<Locator | "missing" | null> {
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
  // Wording that is not on the list: the control is guessed from what it says, never one that talks about something else.
  return (await findButton(page, named)) ?? guessSubmit(frame, field);
}
