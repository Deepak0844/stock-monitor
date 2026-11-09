import { randomUUID } from "node:crypto";
import type { Browser, BrowserContextOptions } from "playwright";
import { classifyPage, type PageClass, type SessionState } from "@stock-monitor/supplier-session";
import type { GuardProxy } from "./proxy.js";

export type VerifyRequest = { url: string; loginUrl?: string; state: SessionState };
/** The answer. It says what the page was and nothing else: never the session, the address it ended on or its text. */
export type VerifyOutcome = { result: PageClass; status: number | null; blockedRequests: number };
export type VerifyOptions = { navigationTimeoutMs?: number; proxy: GuardProxy };

const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_TEXT = 20_000;
// Visible challenge widgets only: a challenge frame, or the widget boxes the big three use.
export const CHALLENGE_WIDGET =
  '.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com/captcha"], iframe[src*="challenges.cloudflare.com"]';

/**
 * Opens a throw-away context holding the saved session in memory, loads the page, and classifies it.
 * All of the context's traffic goes through the guard proxy, which refuses private addresses.
 */
export async function verifyPage(browser: Browser, request: VerifyRequest, options: VerifyOptions): Promise<VerifyOutcome> {
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
    const page = await context.newPage();
    let status: number | null = null;
    try {
      const response = await page.goto(request.url, { timeout: options.navigationTimeoutMs ?? DEFAULT_TIMEOUT_MS, waitUntil: "load" });
      status = response?.status() ?? null;
      // The guard refused the address the page ended on, and Chromium is showing us the guard's own answer.
      if (response?.headers()["x-guard-blocked"] === "private") return { result: "unknown", status, blockedRequests: tracker.blocked().count };
    } catch {
      // A name that cannot be found, a refused connection or a timeout is the supplier being unreachable.
      // An address the guard refused to visit needs the owner's eyes.
      const { count, privateAddress } = tracker.blocked();
      return { result: privateAddress ? "unknown" : "unreachable", status: null, blockedRequests: count };
    }

    const seen = await page.evaluate(
      (selector) => ({
        title: document.title,
        text: (document.body?.innerText ?? "").slice(0, 20_000),
        hasPasswordField: document.querySelector('input[type="password"]') !== null,
        hasChallengeWidget: document.querySelector(selector) !== null,
      }),
      CHALLENGE_WIDGET,
    );
    const result = classifyPage({
      requestedUrl: request.url,
      loginUrl: request.loginUrl,
      page: { finalUrl: page.url(), status, ...seen, text: seen.text.slice(0, MAX_TEXT) },
    });
    return { result, status, blockedRequests: tracker.blocked().count };
  } finally {
    tracker.stop();
    await context.close();
  }
}
