// SPIKE (branch spike/persistent-profile, not for develop): checks a supplier from a persistent, ordinary Chromium instead of
// a fresh, Playwright-controlled one. Question it answers: does the supplier's bot protection treat a long-lived, uncontrolled,
// headed browser differently from our headless check? No spoofing: the browser is real and unmodified.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { PageClass } from "@stock-monitor/supplier-session";
import { plainLaunchArgs, quitCleanly, seedProfile, waitForDebuggingPort } from "./plain-window.js";
import type { GuardProxy } from "./proxy.js";
import type { VerifyOutcome, VerifyRequest } from "./verify.js";

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

export type ProfileCheckOptions = { proxy: GuardProxy; sandbox: boolean; headless: boolean; baseDir?: string; settleMs?: number;
  /** The screen the browser opens on. Not the one VNC shows, or a check would appear in the owner's login window. */
  display?: string };

export function createProfileChecker({ proxy, sandbox, headless, baseDir = join(tmpdir(), "sm-profiles"), settleMs = 12_000, display }: ProfileCheckOptions) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Starts the browser on `profile`. Returns once it is running; `stop` quits it the way a person would. */
  async function launch(profile: string, url: string, debuggable: boolean) {
    const id = randomUUID();
    const tracker = proxy.track(id);
    const listener = await proxy.openListener(id);
    const child = spawn(chromium.executablePath(), plainLaunchArgs({ profile, proxyPort: listener.port, url, headless, sandbox, debuggable }), {
      stdio: "ignore",
      detached: true,
      env: display ? { ...process.env, DISPLAY: display } : process.env,
    });
    return {
      child,
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
    await seedProfile(profile);
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

  async function check(request: VerifyRequest): Promise<VerifyOutcome> {
    const profile = join(baseDir, createHash("sha256").update(new URL(request.url).host).digest("hex").slice(0, 16));
    const hash = createHash("sha256").update(JSON.stringify(request.state.cookies)).digest("hex");
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
    return { result, status: null, blockedRequests: b.blocked() };
  }

  // One at a time: a profile allows one browser, and each browser takes about 900 MB.
  let chain: Promise<unknown> = Promise.resolve();
  return (request: VerifyRequest): Promise<VerifyOutcome> => {
    const run = chain.then(() => check(request));
    chain = run.catch(() => {});
    return run;
  };
}
