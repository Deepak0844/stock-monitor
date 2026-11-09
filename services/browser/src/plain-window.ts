import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { SessionState } from "@stock-monitor/supplier-session";
import { readCookies } from "./chromium-cookies.js";
import { cookieHash, holdProfile, profileDirFor, releaseProfile } from "./profile-store.js";
import type { GuardProxy } from "./proxy.js";
import type { LiveWindow } from "./sessions.js";

/** The window, plus (only in tests) the page, so a test can type into it. */
export type PlainOpenedWindow = LiveWindow & { page?: Page };

export type PlainWindowOptions = {
  proxy: GuardProxy;
  sandbox: boolean;
  /** true only for a machine with no display. The container shows the window on its virtual screen. */
  headless: boolean;
  language?: string;
  /** SPIKE: keep one profile per site in this folder, between logins, instead of a new one each time. */
  persistent?: { baseDir: string };
  /** Test only: attach to the browser straight away so a test can type into it. A person's window is never attached early. */
  exposePage?: boolean;
  startupTimeoutMs?: number;
};

const SCREEN = { width: 1280, height: 800 }; // the virtual screen in the container

/**
 * The command line of an ordinary Chromium. Nothing here controls it or changes how it presents itself: no
 * automation switch, no changed identity, and NO debugging channel. Chromium reports itself as automated to every
 * page the moment any remote-control channel is open, so there is none. The session is read from the browser's own
 * profile after it has been closed. `debuggable` exists only so a test, which has no mouse, can type into the window.
 */
export function plainLaunchArgs(o: {
  profile: string;
  proxyPort: number;
  url: string;
  headless: boolean;
  sandbox: boolean;
  debuggable?: boolean;
  /** A kept profile would grow without limit in memory, so its cache is capped. */
  smallCache?: boolean;
}): string[] {
  return [
    `--user-data-dir=${o.profile}`,
    ...(o.debuggable ? ["--remote-debugging-port=0"] : []), // test only: a free port, written to DevToolsActivePort in the profile
    `--proxy-server=http://127.0.0.1:${o.proxyPort}`,
    "--proxy-bypass-list=<-loopback>", // loopback goes through the guard too, so a page cannot reach anything on this machine
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--disable-dev-shm-usage",
    ...(o.smallCache ? ["--disk-cache-size=33554432"] : []),
    "--window-position=0,0",
    `--window-size=${SCREEN.width},${SCREEN.height}`,
    ...(o.headless ? ["--headless=new"] : []),
    ...(o.sandbox ? [] : ["--no-sandbox"]),
    o.url,
  ];
}

/** Before the browser first runs: no saving of passwords, no autofill, no sign-in, so a typed password is never kept. */
export async function seedProfile(profile: string, language?: string): Promise<void> {
  await mkdir(join(profile, "Default"), { recursive: true });
  const preferences = {
    credentials_enable_service: false,
    profile: { password_manager_enabled: false, password_manager_leak_detection: false },
    autofill: { profile_enabled: false, credit_card_enabled: false },
    signin: { allowed: false },
    browser: { check_default_browser: false },
    // What pages see as the browser's language. Chromium on Linux ignores --lang for this and reads the preference.
    ...(language ? { intl: { accept_languages: `${language},${language.split("-")[0]}` } } : {}),
    // Keeps cookies that have no expiry when the browser closes, so the login can be read from the profile.
    session: { restore_on_startup: 1 },
  };
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify(preferences));
}

/** The port Chromium chose for its debugging channel, once it has written it. */
export async function waitForDebuggingPort(
  profile: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<number> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error("The browser stopped while starting.");
    try {
      const port = Number(
        (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0],
      );
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The browser did not start in time.");
}

const signalGroup = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal); // the browser and everything it started share one process group
  } catch {
    /* already gone */
  }
};

/** Asks the browser to quit the way a person closing it would, which makes it write its profile to disk. */
export const quitCleanly = async (child: ChildProcess, timeoutMs: number) => {
  if (child.exitCode !== null) return;
  const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGINT"); // a graceful shutdown, which writes the cookies to the profile. SIGTERM exits without writing them.
  const timer = setTimeout(() => signalGroup(child, "SIGKILL"), timeoutMs);
  await gone;
  clearTimeout(timer);
  signalGroup(child, "SIGKILL"); // anything it left behind
};

/** Gives the browser a moment, and notices if it stopped straight away. */
const waitForStart = async (child: ChildProcess) => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (child.exitCode !== null) throw new Error("The browser stopped while starting.");
};

/** The browser's cookie store. Its place in the profile depends on the Chromium version. */
const cookieStore = (profile: string) =>
  [join(profile, "Default", "Network", "Cookies"), join(profile, "Default", "Cookies")].find(
    existsSync,
  ) ?? "";

/**
 * Opens a login window as an ordinary Chromium that nothing is controlling. When the owner finishes, the browser is
 * closed the way a person would close it, and the login is read from its profile. Linux only: that is where the
 * service runs, and where Chromium keeps cookies in a form this reads.
 */
export function createPlainWindowOpener({
  proxy,
  sandbox,
  headless,
  language,
  persistent,
  exposePage = false,
  startupTimeoutMs = 20_000,
}: PlainWindowOptions): (url: string) => Promise<PlainOpenedWindow> {
  return async (url) => {
    if (process.platform !== "linux") throw new Error("The plain login window needs Linux.");
    const id = randomUUID();
    const tracker = proxy.track(id);
    const listener = await proxy.openListener(id);
    let profile: string;
    if (persistent) {
      // A check may be using this site's profile. Checks are short, so wait for it rather than refuse the owner.
      profile = profileDirFor(persistent.baseDir, url);
      for (let i = 0; !holdProfile(profile); i++) {
        if (i >= 120) throw new Error("This supplier's profile is in use.");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await mkdir(profile, { recursive: true });
      await rm(join(profile, "DevToolsActivePort"), { force: true });
    } else {
      profile = await mkdtemp(join(tmpdir(), "sm-plain-"));
    }
    let child: ChildProcess | null = null;
    let requested = false;
    let onClosed: (() => void) | null = null;
    let early: Browser | null = null;

    const cleanup = async () => {
      requested = true;
      await early?.close().catch(() => {});
      if (child) await quitCleanly(child, 5000);
      tracker.stop();
      await listener.close().catch(() => {});
      if (persistent) releaseProfile(profile); // the profile stays, with its history, for the next login or check
      else await rm(profile, { recursive: true, force: true }); // takes the profile and everything in it
    };

    try {
      await seedProfile(profile, language);
      child = spawn(
        chromium.executablePath(),
        plainLaunchArgs({
          profile,
          proxyPort: listener.port,
          url,
          headless,
          sandbox,
          smallCache: persistent !== undefined,
          debuggable: exposePage,
        }),
        { stdio: "ignore", detached: true },
      );
      child.once("exit", () => {
        if (!requested) onClosed?.(); // the owner closed the window, or the browser crashed
      });
      let page: Page | undefined;
      if (exposePage) {
        const port = await waitForDebuggingPort(profile, child, startupTimeoutMs);
        early = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const context = early.contexts()[0];
        page = context?.pages()[0] ?? (await context?.waitForEvent("page"));
      } else {
        await waitForStart(child);
      }

      return {
        page,
        async storageState(): Promise<SessionState> {
          requested = true; // the browser is about to quit on purpose, which is not the owner closing it
          await early?.close().catch(() => {});
          early = null;
          await quitCleanly(child as ChildProcess, 10_000); // a clean quit writes the cookies to the profile
          const cookies = readCookies(cookieStore(profile));
          // The check keeps a profile that holds the session it is given, so say which session this profile holds.
          if (persistent) await writeFile(join(profile, "seeded"), cookieHash(cookies));
          return { cookies, origins: [] } as unknown as SessionState;
        },
        close: cleanup,
        onClosed: (callback) => void (onClosed = callback),
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  };
}
