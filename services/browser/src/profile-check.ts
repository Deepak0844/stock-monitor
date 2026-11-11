// SPIKE (branch spike/persistent-profile, not for develop): checks a supplier from a persistent, ordinary Chromium instead of
// a fresh, Playwright-controlled one. Question it answers: does the supplier's bot protection treat a long-lived, uncontrolled,
// headed browser differently from our headless check? No spoofing: the browser is real and unmodified.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { chromium } from "playwright";
import { classifyPage, type PageClass } from "@stock-monitor/supplier-session";
import { plainLaunchArgs, quitCleanly, seedProfile, waitForDebuggingPort } from "./plain-window.js";
import { cookieHash, holdProfile, PROFILE_ROOT, profileDirFor, releaseProfile } from "./profile-store.js";
import type { GuardProxy } from "./proxy.js";
import { createJobQueue } from "./job-queue.js";
import { capturePageIn, type CaptureOutcome, type CaptureRequest } from "./capture.js";
import { CHALLENGE_WIDGET, inspectPage, MAX_TEXT, type BlockTracker, type CheckPageOutcome, type CheckPageRequest, type VerifyOutcome, type VerifyRequest } from "./verify.js";

const CHALLENGE_TITLE = /just a moment|attention required|verify|human|captcha|security check|checking your browser/i;
const BLOCKED_TITLE = /access denied|forbidden|blocked|error 1020|too many requests/i;
const LOGIN_PATH = /\/(?:log-?in|sign-?in|sign_in|log_in)(?:[/?#.]|$)/;

/**
 * What the browser's own History says about the page: only the title and the address it ended on, because nothing may
 * read the page while it loads. Weaker than classifyPage (no text, no status), so it never claims more than "looks real".
 */
export function classifyByTitle(o: { url: string; loginUrl?: string; finalUrl: string | null; title: string }): PageClass {
  if (!o.finalUrl) return "unknown";
  if (CHALLENGE_TITLE.test(o.title)) return "captcha";
  if (BLOCKED_TITLE.test(o.title)) return "blocked";
  const host = (u: string) => new URL(u).host.replace(/^www\./, "");
  const final = new URL(o.finalUrl);
  if (host(o.finalUrl) !== host(o.url)) return "unknown";
  if (LOGIN_PATH.test(final.pathname)) return "login_required";
  if (o.loginUrl && final.pathname.replace(/\/$/, "") === new URL(o.loginUrl).pathname.replace(/\/$/, "")) return "login_required";
  return o.title.trim() === "" ? "unknown" : "ok";
}

/** The newest real page in a profile's History, after the browser has quit. */
export function lastVisited(profile: string): { url: string; title: string } | null {
  const file = join(profile, "Default", "History");
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = // A redirect's source and target share a time, so the visit id (later for the target) breaks the tie.
    db.prepare("select u.url, u.title from visits v join urls u on u.id = v.url order by v.visit_time desc, v.id desc limit 10").all() as { url: string; title: string }[];
    return rows.find((r) => /^https?:/.test(r.url)) ?? null;
  } finally {
    db.close();
  }
}

export type ProfileCheckOptions = { proxy: GuardProxy; sandbox: boolean; headless: boolean; baseDir?: string; settleMs?: number; language?: string;
  /** The screen the browser opens on. Not the one VNC shows, or a check would appear in the owner's login window. */
  display?: string };

/** `signal` fires when the caller has gone away; a job still waiting is then dropped. */
export type JobOptions = { signal?: AbortSignal };

export function createProfileChecker({ proxy, sandbox, headless, baseDir = PROFILE_ROOT, settleMs = 12_000, display, language }: ProfileCheckOptions) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Starts the browser on `profile`. Returns once it is running; `stop` quits it the way a person would. */
  async function launch(profile: string, url: string, debuggable: boolean) {
    // A clean quit leaves the last port behind, and a new launch must not be mistaken for it.
    if (debuggable) await rm(join(profile, "DevToolsActivePort"), { force: true });
    const id = randomUUID();
    const tracker = proxy.track(id);
    const listener = await proxy.openListener(id);
    const child = spawn(chromium.executablePath(), plainLaunchArgs({ profile, proxyPort: listener.port, url, headless, sandbox, debuggable, smallCache: true }), {
      stdio: "ignore",
      detached: true,
      env: display ? { ...process.env, DISPLAY: display } : process.env,
    });
    return {
      child,
      tracker,
      blocked: () => tracker.blocked().count,
      async stop() {
        await quitCleanly(child, 10_000);
        tracker.stop();
        await listener.close().catch(() => {});
      },
    };
  }

  /** Puts the saved cookies into a new profile. The debugging channel is open only here, on a blank page, then the browser quits. */
  async function seed(profile: string, state: VerifyRequest["state"]) {
    await rm(profile, { recursive: true, force: true });
    await mkdir(profile, { recursive: true });
    await seedProfile(profile, language);
    const b = await launch(profile, "about:blank", true);
    try {
      const port = await waitForDebuggingPort(profile, b.child, 20_000);
      const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      await cdp.contexts()[0]?.addCookies(state.cookies as Parameters<NonNullable<ReturnType<typeof cdp.contexts>[0]>["addCookies"]>[0]);
      await cdp.close();
    } finally {
      await b.stop();
    }
  }

  /**
   * Step 2, only when the title could not say. The same profile, now with a debugging channel, loads the page again and
   * reads its text, so the normal classifier can decide. By now step 1 has already been through any challenge, and the
   * profile holds what it earned. A page that cannot be read leaves the answer as it was: unknown.
   */
  async function readPage(profile: string, request: VerifyRequest): Promise<{ result: PageClass; status: number | null } | null> {
    const b = await launch(profile, "about:blank", true);
    try {
      const port = await waitForDebuggingPort(profile, b.child, 20_000);
      const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      try {
        const context = cdp.contexts()[0];
        const page = context?.pages()[0] ?? (await context?.newPage());
        if (!page) return null;
        const response = await page.goto(request.url, { timeout: 20_000, waitUntil: "load" });
        const status = response?.status() ?? null;
        const seen = await page.evaluate(
          (selector) => ({
            title: document.title,
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
        const result = classifyPage({
          requestedUrl: request.url,
          loginUrl: request.loginUrl,
          page: { finalUrl: page.url(), status, ...seen, text: seen.text.slice(0, MAX_TEXT) },
        });
        return { result, status };
      } finally {
        await cdp.close().catch(() => {});
      }
    } catch {
      return null; // refused, too slow or closed: say nothing more than step 1 did
    } finally {
      await b.stop();
    }
  }

  async function check(request: VerifyRequest): Promise<VerifyOutcome> {
    const profile = profileDirFor(baseDir, request.url);
    const hash = cookieHash(request.state.cookies);
    // The owner is logging in to this site in this profile. A check says nothing and is tried again.
    if (!holdProfile(profile)) return { result: "unreachable", status: null, blockedRequests: 0 };
    try {
      return await checkHeld(request, profile, hash);
    } finally {
      releaseProfile(profile);
    }
  }

  async function checkHeld(request: VerifyRequest, profile: string, hash: string): Promise<VerifyOutcome> {
    const marker = join(profile, "seeded");
    const seededWith = await readFile(marker, "utf8").catch(() => "");
    // A new login replaces the profile; an unchanged session keeps it, with its history and cache.
    if (seededWith !== hash) {
      await seed(profile, request.state);
      await writeFile(marker, hash);
    }
    const b = await launch(profile, request.url, false); // nothing controls it while the page loads
    try {
      await sleep(settleMs);
    } finally {
      await b.stop(); // a clean quit writes the History
    }
    const seen = lastVisited(profile);
    const result = seen
      ? classifyByTitle({ url: request.url, loginUrl: request.loginUrl, finalUrl: seen.url, title: seen.title })
      : "unreachable";
    if (result === "unknown") {
      const read = await readPage(profile, request);
      if (read) return { result: read.result, status: read.status, blockedRequests: b.blocked() };
    }
    return { result, status: null, blockedRequests: b.blocked() };
  }

  /**
   * Runs `run` on a page of the persistent profile, the logged-in browser that passes the supplier's checks. The browser keeps the
   * profile's cookies and history; the debugging channel is open only for the length of `run`. If the profile is busy or the browser
   * cannot be driven, the answer is `unavailable`, which the caller treats as "could not check".
   */
  async function inProfile<T>(request: VerifyRequest, unavailable: T, run: (page: import("playwright").Page, tracker: BlockTracker) => Promise<T>): Promise<T> {
    const profile = profileDirFor(baseDir, request.url);
    if (!holdProfile(profile)) return unavailable;
    try {
      const hash = cookieHash(request.state.cookies);
      if ((await readFile(join(profile, "seeded"), "utf8").catch(() => "")) !== hash) {
        await seed(profile, request.state);
        await writeFile(join(profile, "seeded"), hash);
      }
      const b = await launch(profile, "about:blank", true);
      try {
        const port = await waitForDebuggingPort(profile, b.child, 20_000);
        const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        try {
          const context = cdp.contexts()[0];
          const page = context?.pages()[0] ?? (await context?.newPage());
          return page ? await run(page, b.tracker) : unavailable;
        } finally {
          await cdp.close().catch(() => {});
        }
      } catch {
        return unavailable;
      } finally {
        await b.stop();
      }
    } finally {
      releaseProfile(profile);
    }
  }

  const noPage = { result: "unreachable" as const, status: null, blockedRequests: 0, finalUrl: null, title: null, heading: null, softNotFound: false };

  // One at a time: a profile allows one browser, and each browser takes about 900 MB.
  // A person waiting (verify, capture) goes before scheduled checks; a caller that has gone never gets its job run.
  const queue = createJobQueue();

  const verify = (request: VerifyRequest, opts: JobOptions = {}): Promise<VerifyOutcome> => queue.run(() => check(request), { urgent: true, signal: opts.signal });
  return Object.assign(verify, {
    checkPage: (request: CheckPageRequest, timeoutMs = 20_000, opts: JobOptions = {}): Promise<CheckPageOutcome> =>
      queue.run(() => inProfile(request, noPage as CheckPageOutcome, (page, tracker) => inspectPage(page, request, tracker, timeoutMs)), { signal: opts.signal }),
    capture: (request: CaptureRequest, timeoutMs = 20_000, opts: JobOptions = {}): Promise<CaptureOutcome> =>
      queue.run(() => inProfile(request, { ...noPage, description: { sections: [], buttons: [] }, picture: null } as CaptureOutcome, (page, tracker) => capturePageIn(page, request, tracker, timeoutMs)), { urgent: true, signal: opts.signal }),
  });
}
