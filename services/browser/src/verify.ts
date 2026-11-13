import { randomUUID } from "node:crypto";
import type { Browser, BrowserContextOptions, Page } from "playwright";
import { explainPage, looksLikeNotFound, type PageClass, type SessionState } from "@stock-monitor/supplier-session";
import type { GuardProxy } from "./proxy.js";

export type VerifyRequest = { url: string; loginUrl?: string; state: SessionState };
/**
 * The answer. It says what the page was: never the address it ended on or its text. After an ok page only, `state` is the
 * session the browser ended with, so the worker can keep a session the supplier extended. It goes only to the worker.
 */
export type VerifyOutcome = { result: PageClass; status: number | null; blockedRequests: number; state?: SessionState };
/**
 * What a link check saw. The address has no query string or fragment (they can hold secrets), and the title and
 * heading are cut short. Never the page text, prices or stock.
 */
export type CheckPageOutcome = VerifyOutcome & { finalUrl: string | null; title: string | null; heading: string | null; softNotFound: boolean; signal?: string };
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
    const outcome = await inspectPage(await context.newPage(), request, tracker, options.navigationTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    return await withFreshState(outcome, async () => (await context.storageState()) as SessionState);
  } finally {
    tracker.stop();
    await context.close();
  }
}

/**
 * Adds the session the browser ended with, only when the page was ok: a login, puzzle or block page must never replace a session.
 * Refreshing is a side task, so a session that cannot be read leaves the answer as it was.
 */
export async function withFreshState<T extends VerifyOutcome>(outcome: T, read: () => Promise<SessionState>): Promise<T> {
  if (outcome.result !== "ok") return outcome;
  try {
    return { ...outcome, state: await read() };
  } catch {
    return outcome;
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
      hasPasswordField: [...document.querySelectorAll('input[type="password"]')].some((el) => {
        // A sign-in popup that is hidden until someone clicks it is not a login wall.
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1;
      }),
      hasChallengeWidget: [...document.querySelectorAll(selector)].some((el) => {
        // An invisible or off-screen widget (a form's spam guard) is not a puzzle in front of the page.
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return el.getAttribute("data-size") !== "invisible" && box.width >= 50 && box.height >= 30 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1 && box.bottom > 0 && box.right > 0;
      }),
    }),
    CHALLENGE_WIDGET,
  );
  const { result, signal } = explainPage({
    requestedUrl: request.url,
    loginUrl: request.loginUrl,
    page: { finalUrl: page.url(), status, title: seen.title, text: seen.text.slice(0, MAX_TEXT), hasPasswordField: seen.hasPasswordField, hasChallengeWidget: seen.hasChallengeWidget },
  });
  const title = short(seen.title);
  const heading = short(seen.heading);
  return { result, status, blockedRequests: tracker.blocked().count, finalUrl: withoutQuery(page.url()), title, heading, softNotFound: looksLikeNotFound({ title, heading }), signal };
}

/** The session check: only what the page was. It never reports the address, title or text. */
export async function verifyPage(browser: Browser, request: VerifyRequest, options: VerifyOptions): Promise<VerifyOutcome> {
  const { result, status, blockedRequests, state } = await checkPage(browser, request, options);
  return { result, status, blockedRequests, ...(state ? { state } : {}) };
}
