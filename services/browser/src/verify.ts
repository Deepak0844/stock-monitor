import { randomUUID } from "node:crypto";
import type { Browser, BrowserContextOptions, Page } from "playwright";
import { classifyPage, looksLikeNotFound, type PageClass, type SessionState } from "@stock-monitor/supplier-session";
import type { GuardProxy } from "./proxy.js";

export type VerifyRequest = { url: string; loginUrl?: string; state: SessionState };
/** The answer. It says what the page was and nothing else: never the session, the address it ended on or its text. */
export type VerifyOutcome = { result: PageClass; status: number | null; blockedRequests: number };
/**
 * What a link check saw. The address has no query string or fragment (they can hold secrets), and the title and
 * heading are cut short. Never the page text, prices or stock.
 */
export type CheckPageOutcome = VerifyOutcome & { finalUrl: string | null; title: string | null; heading: string | null; softNotFound: boolean };
export type CheckPageRequest = { url: string; loginUrl?: string; state: SessionState };
export type VerifyOptions = { navigationTimeoutMs?: number; proxy: GuardProxy };

const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_TEXT = 20_000;
// Visible challenge widgets only: a challenge frame, or the widget boxes the big three use.
export const CHALLENGE_WIDGET =
  '.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com/captcha"], iframe[src*="challenges.cloudflare.com"]';

const MAX_FIELD = 200;
const short = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) || null;
const withoutQuery = (address: string): string | null => {
  try {
    const url = new URL(address);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
};

/**
 * Opens a throw-away context holding the saved session in memory, loads the page, and says what it was.
 * All of the context's traffic goes through the guard proxy, which refuses private addresses.
 */
export async function checkPage(browser: Browser, request: CheckPageRequest, options: VerifyOptions): Promise<CheckPageOutcome> {
  const id = randomUUID();
  const tracker = options.proxy.track(id);
  const context = await browser.newContext({
    // The state is handed over as an object. It is never written to a file.
    storageState: request.state as BrowserContextOptions["storageState"],
    serviceWorkers: "block",
    acceptDownloads: false,
    proxy: { server: `http://127.0.0.1:${options.proxy.port}`, username: id, password: options.proxy.secret, bypass: "<-loopback>" },
  });
  try {
    return await inspectPage(await context.newPage(), request, tracker, options.navigationTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  } finally {
    tracker.stop();
    await context.close();
  }
}

/** What a page load blocked, as the guard proxy counted it. */
export type BlockTracker = { blocked(): { count: number; privateAddress: boolean } };

/** Loads `request.url` in an already prepared page and says what it was. Used with a throw-away context and with the persistent profile. */
export async function inspectPage(page: Page, request: CheckPageRequest, tracker: BlockTracker, timeoutMs: number): Promise<CheckPageOutcome> {
  const nothing = { finalUrl: null, title: null, heading: null, softNotFound: false };
  let status: number | null;
  try {
    const response = await page.goto(request.url, { timeout: timeoutMs, waitUntil: "load" });
    status = response?.status() ?? null;
    // The guard refused the address the page ended on, and Chromium is showing us the guard's own answer.
    if (response?.headers()["x-guard-blocked"] === "private") return { result: "unknown", status, blockedRequests: tracker.blocked().count, ...nothing };
  } catch {
    // A name that cannot be found, a refused connection or a timeout is the supplier being unreachable.
    // An address the guard refused to visit needs the owner's eyes.
    const { count, privateAddress } = tracker.blocked();
    return { result: privateAddress ? "unknown" : "unreachable", status: null, blockedRequests: count, ...nothing };
  }

  const seen = await page.evaluate(
    (selector) => ({
      title: document.title,
      heading: document.querySelector("h1")?.textContent ?? "",
      text: (document.body?.innerText ?? "").slice(0, 20_000),
      hasPasswordField: document.querySelector('input[type="password"]') !== null,
      hasChallengeWidget: document.querySelector(selector) !== null,
    }),
    CHALLENGE_WIDGET,
  );
  const result = classifyPage({
    requestedUrl: request.url,
    loginUrl: request.loginUrl,
    page: { finalUrl: page.url(), status, title: seen.title, text: seen.text.slice(0, MAX_TEXT), hasPasswordField: seen.hasPasswordField, hasChallengeWidget: seen.hasChallengeWidget },
  });
  const title = short(seen.title);
  const heading = short(seen.heading);
  return { result, status, blockedRequests: tracker.blocked().count, finalUrl: withoutQuery(page.url()), title, heading, softNotFound: looksLikeNotFound({ title, heading }) };
}

/** The session check: only what the page was. It never reports the address, title or text. */
export async function verifyPage(browser: Browser, request: VerifyRequest, options: VerifyOptions): Promise<VerifyOutcome> {
  const { result, status, blockedRequests } = await checkPage(browser, request, options);
  return { result, status, blockedRequests };
}
