import { chromium, type Browser } from "playwright";
import type { AddressInfo } from "node:net";
import { createControlServer } from "./server.js";
import { createGuard, type GuardOptions } from "./guard.js";
import { startGuardProxy } from "./proxy.js";
import { createSessions } from "./sessions.js";
import { createPlainWindowOpener } from "./plain-window.js";
import { createWindowOpener, type OpenedWindow } from "./window.js";
import type { Page } from "playwright";
import { verifyPage } from "./verify.js";
import { createProfileChecker } from "./profile-check.js";
import { PROFILE_ROOT } from "./profile-store.js";

export type BrowserServiceOptions = {
  token: string;
  port: number;
  host: string;
  navigationTimeoutMs?: number;
  /** Chromium's own sandbox. On unless a host cannot allow it. */
  sandbox?: boolean;
  guard?: GuardOptions;
  /** How long a login window may stay open. */
  sessionTimeoutMs?: number;
  /** How the live login window starts. `controlled` is the default and has always been. `plain` is an ordinary browser nothing controls. */
  loginWindowMode?: "controlled" | "plain";
  /** Test only: attach a test to a plain window as soon as it opens. A person's window is never attached until they finish. */
  exposePageForTests?: boolean;
  /** SPIKE: `profile` checks from a persistent, uncontrolled, headed Chromium. Default `headless`. */
  verifyMode?: "headless" | "profile";
  /** SPIKE: `persistent` keeps one login-window profile per supplier site between logins. Default `fresh`. */
  loginProfile?: "fresh" | "persistent";
  /** Test only: how long the profile check lets the page load. */
  profileSettleMs?: number;
  /** Test only: where the profile check keeps its profiles. */
  profileDir?: string;
  /** The owner's real browser language, passed to plain windows. */
  language?: string;
  /** The VNC password to give callers who open a window. */
  vncPassword?: string;
  /** false opens login windows with no display, for a machine that has none (tests). The container shows them on its virtual screen. */
  headedWindows?: boolean;
  log?: (line: string) => void;
};
export type BrowserService = {
  url: string;
  /** For tests only: the page in the open login window, so a test can type into it. Not reachable from outside the process. */
  loginPage(): Page | null;
  close(): Promise<void>;
};

const MIN_TOKEN = 32;

export async function startBrowserService(options: BrowserServiceOptions): Promise<BrowserService> {
  if (options.token.length < MIN_TOKEN)
    throw new Error(`The control token must be at least ${MIN_TOKEN} characters.`);

  const proxy = await startGuardProxy(createGuard(options.guard));

  // One Chromium is shared. Every check still gets its own throw-away context. A crashed browser is replaced on the next check.
  let launching: Promise<Browser> | null = null;
  const getBrowser = async (): Promise<Browser> => {
    const current = launching ? await launching.catch(() => null) : null;
    if (current?.isConnected()) return current;
    // Each check names its own proxy login. Chromium normally skips the proxy for local addresses, so that is switched off.
    launching = chromium.launch({
      headless: true,
      chromiumSandbox: options.sandbox ?? true,
      proxy: { server: "per-context" },
      args: ["--proxy-bypass-list=<-loopback>"],
    });
    return launching;
  };
  await getBrowser();

  let open: OpenedWindow | null = null;
  const windowOptions = {
    proxy,
    sandbox: options.sandbox ?? true,
    headless: !(options.headedWindows ?? true),
  };
  const plainOptions = {
    ...windowOptions,
    language: options.language,
    persistent: options.loginProfile === "persistent" ? { baseDir: options.profileDir ?? PROFILE_ROOT } : undefined,
  };
  const openWindow =
    options.loginWindowMode === "plain"
      ? createPlainWindowOpener({ ...plainOptions, exposePage: options.exposePageForTests })
      : createWindowOpener(windowOptions);
  const sessions = createSessions({
    timeoutMs: options.sessionTimeoutMs,
    openWindow: async (url) => {
      const window = await openWindow(url);
      open = window;
      window.onClosed(() => void (open = open === window ? null : open));
      return window;
    },
  });

  const checkInProfile =
    options.verifyMode === "profile"
      ? createProfileChecker({ ...plainOptions, baseDir: options.profileDir, settleMs: options.profileSettleMs, display: process.env.CHECK_DISPLAY })
      : null;

  const server = createControlServer({
    token: options.token,
    log: options.log,
    sessions,
    vncPassword: options.vncPassword,
    verify: async (request) =>
      checkInProfile?.(request) ??
      verifyPage(await getBrowser(), request, {
        navigationTimeoutMs: options.navigationTimeoutMs,
        proxy,
      }),
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${options.host}:${port}`,
    loginPage: () => open?.page ?? null,
    async close() {
      await sessions.closeAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await (await launching?.catch(() => null))?.close();
      await proxy.close();
    },
  };
}
