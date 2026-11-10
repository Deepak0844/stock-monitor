import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import type { SessionState } from "@stock-monitor/supplier-session";
import type { GuardProxy } from "./proxy.js";
import type { LiveWindow, OpenWindow } from "./sessions.js";

export type WindowOptions = {
  proxy: GuardProxy;
  sandbox: boolean;
  /** false shows the window on the display (DISPLAY, the virtual screen in the container). true is for machines with no display. */
  headless: boolean;
  navigationTimeoutMs?: number;
};
/** The window, plus the page so a test can type into it. Nothing outside the service sees the page. */
export type OpenedWindow = LiveWindow & { page?: Page };

const SCREEN = { width: 1280, height: 800 }; // the virtual screen in the container

/** Opens a fresh Chromium for one login. Everything it loads goes through the guard proxy. */
export function createWindowOpener({
  proxy,
  sandbox,
  headless,
  navigationTimeoutMs = 15_000,
}: WindowOptions): (url: string) => Promise<OpenedWindow> {
  return async (url) => {
    const id = randomUUID();
    const tracker = proxy.track(id);
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless,
        chromiumSandbox: sandbox,
        proxy: { server: "per-context" },
        args: [
          "--proxy-bypass-list=<-loopback>",
          "--window-position=0,0",
          `--window-size=${SCREEN.width},${SCREEN.height}`,
        ],
      });
      const context = await browser.newContext({
        viewport: null, // the page fills the window
        acceptDownloads: false,
        proxy: {
          server: `http://127.0.0.1:${proxy.port}`,
          username: id,
          password: proxy.secret,
          bypass: "<-loopback>",
        },
      });
      const page = await context.newPage();
      // If the supplier is slow or down, the window still opens and shows the browser's own error page.
      await page.goto(url, { timeout: navigationTimeoutMs }).catch(() => {});

      const opened = browser;
      return {
        page,
        storageState: async () => (await context.storageState()) as SessionState,
        close: async () => {
          tracker.stop();
          await opened.close(); // also removes Chromium's temporary profile folder
        },
        onClosed: (callback) => void opened.on("disconnected", callback),
      };
    } catch (error) {
      tracker.stop();
      await browser?.close().catch(() => {});
      throw error;
    }
  };
}

export type { OpenWindow };
