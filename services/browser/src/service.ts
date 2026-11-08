import { chromium, type Browser } from "playwright";
import type { AddressInfo } from "node:net";
import { createControlServer } from "./server.js";
import { createGuard, type GuardOptions } from "./guard.js";
import { startGuardProxy } from "./proxy.js";
import { verifyPage } from "./verify.js";

export type BrowserServiceOptions = {
  token: string;
  port: number;
  host: string;
  navigationTimeoutMs?: number;
  /** Chromium's own sandbox. On unless a host cannot allow it. */
  sandbox?: boolean;
  guard?: GuardOptions;
  log?: (line: string) => void;
};
export type BrowserService = { url: string; close(): Promise<void> };

const MIN_TOKEN = 32;

export async function startBrowserService(options: BrowserServiceOptions): Promise<BrowserService> {
  if (options.token.length < MIN_TOKEN) throw new Error(`The control token must be at least ${MIN_TOKEN} characters.`);

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

  const server = createControlServer({
    token: options.token,
    log: options.log,
    verify: async (request) =>
      verifyPage(await getBrowser(), request, { navigationTimeoutMs: options.navigationTimeoutMs, proxy }),
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${options.host}:${port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await (await launching?.catch(() => null))?.close();
      await proxy.close();
    },
  };
}
