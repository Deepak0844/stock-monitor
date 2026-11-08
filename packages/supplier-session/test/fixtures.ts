// What the browser service will report for a page, saved from realistic examples. Private details are
// made up. Each one says what the classifier must answer. Long pages are padded with ordinary shop text.
import type { PageFacts } from "../src/classify.js";

export type Fixture = { name: string; expected: string; facts: PageFacts };

const SHOP = "https://shop.acme.example";
const filler = (words: number) => Array.from({ length: words }, (_, i) => ["wholesale", "pack", "case", "price", "stock", "carton", "unit"][i % 7]).join(" ");

const PRODUCT_TEXT = `Acme Supply Home Products Cart Account Blue Widget 12 pack. In stock. Wholesale price £48.00 per case. Add to basket. Delivery within three working days. ${filler(60)}`;
const page = (over: Partial<NonNullable<PageFacts["page"]>> = {}): NonNullable<PageFacts["page"]> => ({
  finalUrl: `${SHOP}/products/blue-widget`,
  status: 200,
  title: "Blue Widget 12 pack | Acme Supply",
  text: PRODUCT_TEXT,
  hasPasswordField: false,
  hasChallengeWidget: false,
  ...over,
});
const facts = (over: Partial<NonNullable<PageFacts["page"]>> = {}, extra: Partial<PageFacts> = {}): PageFacts => ({
  requestedUrl: `${SHOP}/products/blue-widget`,
  page: page(over),
  ...extra,
});

export const fixtures: Fixture[] = [
  { name: "a normal product page", expected: "ok", facts: facts() },
  { name: "a normal page whose reviews mention an access denied error and a captcha", expected: "ok",
    facts: facts({ text: `${PRODUCT_TEXT} Reviews. "Great stock levels, but the old site gave me an Access denied message and a captcha twice before I could order." ${filler(400)}` }) },
  { name: "a normal page that talks about logging in to track orders", expected: "ok",
    facts: facts({ text: `${PRODUCT_TEXT} You are signed in as Pat. Your orders. Account settings. ${filler(40)}` }) },
  { name: "the same shop reached without www", expected: "ok",
    facts: facts({ finalUrl: "https://www.shop.acme.example/products/blue-widget" }) },

  { name: "a redirect to the login page", expected: "login_required",
    facts: facts({ finalUrl: `${SHOP}/account/login?return=%2Fproducts%2Fblue-widget`, title: "Log in | Acme Supply", text: "Log in. Email. Password. Forgot your password? Create account.", hasPasswordField: true }) },
  { name: "a page with a password field and no login address", expected: "login_required",
    facts: facts({ title: "Welcome", text: `${PRODUCT_TEXT} Email Password`, hasPasswordField: true }) },
  { name: "a price list hidden behind a login", expected: "login_required",
    facts: facts({ text: `${PRODUCT_TEXT} Log in to see prices. ${filler(30)}` }) },
  { name: "an expired session message", expected: "login_required",
    facts: facts({ title: "Session expired", text: "Your session has expired. For your security please sign in again to continue." }) },
  { name: "a plain 401", expected: "login_required",
    facts: facts({ status: 401, title: "Unauthorized", text: "Unauthorized" }) },
  { name: "the owner's own login address, with different wording", expected: "login_required",
    facts: facts({ finalUrl: `${SHOP}/entrance`, title: "Welcome back", text: `Welcome back to Acme. ${filler(80)}` }, { loginUrl: `${SHOP}/entrance` }) },

  { name: "a reCAPTCHA widget on the page", expected: "captcha",
    facts: facts({ title: "Just checking", text: `Please wait. ${filler(10)}`, hasChallengeWidget: true }) },
  { name: "a Cloudflare 'Just a moment' check", expected: "captcha",
    facts: facts({ status: 403, title: "Just a moment...", text: "Checking your browser before accessing shop.acme.example. This process is automatic. Verify you are human." }) },
  { name: "a 'verify you are human' page", expected: "captcha",
    facts: facts({ title: "Security check", text: "Please verify you are human to continue." }) },
  { name: "an 'I'm not a robot' box with a curly apostrophe", expected: "captcha",
    facts: facts({ title: "Check", text: "Before you continue: ☐ I’m not a robot" }) },
  { name: "a login page that also shows a challenge", expected: "captcha",
    facts: facts({ title: "Log in", text: "Log in Email Password", hasPasswordField: true, hasChallengeWidget: true }) },

  { name: "a 403 with an access denied page", expected: "blocked",
    facts: facts({ status: 403, title: "Access denied", text: "Access denied. You do not have permission to access this site." }) },
  { name: "a bare 403", expected: "blocked", facts: facts({ status: 403, title: "", text: "" }) },
  { name: "a 429 rate limit", expected: "blocked", facts: facts({ status: 429, title: "Too many requests", text: "Too many requests. Slow down." }) },
  { name: "a 200 page that says the visitor is blocked", expected: "blocked",
    facts: facts({ title: "Blocked", text: "You have been blocked. Your request has been blocked by the site owner. Reference 1020." }) },

  { name: "no answer at all (network failure or timeout)", expected: "unreachable", facts: { requestedUrl: `${SHOP}/`, page: null } },
  { name: "a 503 maintenance page", expected: "unreachable", facts: facts({ status: 503, title: "Back soon", text: "We are down for maintenance." }) },
  { name: "a 502 bad gateway", expected: "unreachable", facts: facts({ status: 502, title: "502 Bad Gateway", text: "Bad Gateway" }) },

  { name: "a page not found", expected: "unknown", facts: facts({ status: 404, title: "Page not found", text: "Sorry, we can't find that page." }) },
  { name: "a 200 'page not found' page", expected: "unknown", facts: facts({ title: "Page not found | Acme", text: `Oops. This page is no longer available. ${filler(20)}` }) },
  { name: "a blank page", expected: "unknown", facts: facts({ title: "", text: "" }) },
  { name: "a nearly empty page", expected: "unknown", facts: facts({ title: "Acme", text: "Loading..." }) },
  { name: "a redirect to an unrelated website", expected: "unknown",
    facts: facts({ finalUrl: "https://parked-domain.example/", title: "Welcome", text: PRODUCT_TEXT }) },
  { name: "a redirect that was not followed", expected: "unknown", facts: facts({ status: 302, title: "", text: "" }) },
  { name: "an odd 4xx", expected: "unknown", facts: facts({ status: 418, title: "Teapot", text: "I am a teapot" }) },
  { name: "no status was reported", expected: "unknown", facts: facts({ status: null }) },
];
