/** What the browser service saw when it loaded a supplier page. `page` is null when nothing came back. */
export type PageFacts = {
  /** The address that was asked for. */
  requestedUrl: string;
  /** The owner's login address for this supplier, if they gave one. */
  loginUrl?: string;
  page: {
    /** The address after any redirects. */
    finalUrl: string;
    status: number | null;
    title: string;
    /** The visible text, or the start of it. */
    text: string;
    hasPasswordField: boolean;
    /** A known challenge widget is on the page: reCAPTCHA, hCaptcha or Turnstile. */
    hasChallengeWidget: boolean;
  } | null;
};

export type PageClass = "ok" | "login_required" | "captcha" | "blocked" | "unreachable" | "unknown";

// A page with less text than this is not proof of anything.
const MIN_CONTENT = 200;
// Warning wording only counts in the title, or on a short page. A long product page that mentions
// "access denied" in a review is still a product page.
const SHORT_PAGE = 2000;

const CAPTCHA_WORDS = [
  /verify (?:that )?you(?: are|'re) (?:a )?human/, /verifying you are human/, /confirm you(?: are|'re) (?:a )?human/,
  /prove you(?: are|'re) (?:a )?human/, /i(?:'m| am) not a robot/, /are you (?:a robot|human)/,
  /complete the security check/, /checking your browser/, /unusual traffic from your/, /(?:solve|complete) the captcha/,
  /just a moment/, /attention required/,
];
const BLOCK_WORDS = [
  /access denied/, /access to this (?:page|site|website) has been (?:denied|restricted)/, /you (?:have been|are) blocked/,
  /request (?:has been )?blocked/, /403 forbidden/, /error 1020/, /too many requests/, /rate limit exceeded/, /automated access/,
];
// These count anywhere on the page: a wholesale site often shows its products with the prices hidden.
const LOGIN_WORDS = [
  /\b(?:log ?in|sign ?in) (?:to|in order to) (?:see|view|continue|access|order|buy|purchase)\b/,
  /session (?:has )?(?:expired|timed out)/, /you(?:'ve| have) been (?:logged|signed) out/,
  /please (?:log ?in|sign ?in)/, /login required/,
];
const ERROR_WORDS = [/page not found/, /no longer available/, /(?:page|site) (?:doesn't|does not) exist/, /something went wrong/];
const LOGIN_PATH = /\/(?:log-?in|sign-?in|sign_in|log_in)(?:[/?#.]|$)/;

const normalise = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const hostOf = (url: string) => new URL(url).host.replace(/^www\./, "");
const matches = (words: RegExp[], text: string) => words.some((w) => w.test(text));

/** True when `url` is the owner's login address. The query and #fragment are ignored. */
function isLoginAddress(url: string, loginUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(loginUrl);
    return a.host === b.host && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

/**
 * Decides what a supplier page is. Pure: it only looks at what it is given.
 * When unsure it says `unknown`, which needs attention. It never calls an unclear page `ok`, and
 * "ok" never means more than "this looks like the real, working page".
 */
export function classifyPage(facts: PageFacts): PageClass {
  const { page } = facts;
  if (!page) return "unreachable";

  const { status } = page;
  if (status !== null && status >= 500) return "unreachable"; // the supplier's server is struggling: try again later

  const title = normalise(page.title);
  const text = normalise(page.text);
  const short = text.length <= SHORT_PAGE;
  const says = (words: RegExp[]) => matches(words, title) || (short && matches(words, text));

  if (page.hasChallengeWidget || says(CAPTCHA_WORDS)) return "captcha";
  if (status === 403 || status === 429 || says(BLOCK_WORDS)) return "blocked";

  let loginAddress: boolean;
  try {
    loginAddress = LOGIN_PATH.test(new URL(page.finalUrl).pathname) || (!!facts.loginUrl && isLoginAddress(page.finalUrl, facts.loginUrl));
  } catch {
    return "unknown";
  }
  if (status === 401 || page.hasPasswordField || loginAddress || matches(LOGIN_WORDS, title) || matches(LOGIN_WORDS, text)) {
    return "login_required";
  }

  // Everything below is about whether this really is the working page.
  let sameSite: boolean;
  try {
    sameSite = hostOf(page.finalUrl) === hostOf(facts.requestedUrl);
  } catch {
    return "unknown";
  }
  const answered = status !== null && status >= 200 && status < 300;
  if (!answered || !sameSite || text.length < MIN_CONTENT || says(ERROR_WORDS)) return "unknown";
  return "ok";
}
