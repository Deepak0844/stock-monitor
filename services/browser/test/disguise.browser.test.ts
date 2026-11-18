// The stealth live window's disguise against real Chromium: a real graphics card and Google Chrome's brands, in the page
// and in its frames, and the real values again for a window without it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { createGuard } from "../src/guard.js";
import { startGuardProxy, type GuardProxy } from "../src/proxy.js";
import { chromeBrands, chromeVersion, secChUa } from "../src/disguise.js";
import { createPlainWindowOpener } from "../src/plain-window.js";

vi.setConfig({ testTimeout: 30_000 });
const linux = process.platform === "linux";
let site: Server;
let url = "";
let proxy: GuardProxy;
let header = "";

beforeAll(async () => {
  if (!linux) return;
  site = createServer((req, res) => {
    if (req.url === "/frame") header = String(req.headers["sec-ch-ua"]);
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/frame" ? "<p>frame</p>" : '<iframe src="/frame"></iframe>');
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const host = `127.0.0.1:${(site.address() as AddressInfo).port}`;
  url = `http://${host}/`;
  proxy = await startGuardProxy(createGuard({ allowHosts: [host] }));
});
afterAll(async () => {
  await proxy?.close();
  await new Promise((resolve) => site?.close(resolve));
});

// Function source in a string, so tsx cannot wrap it in a helper the page lacks.
const PROBE = `(async () => {
  const gl = document.createElement("canvas").getContext("webgl");
  return {
    renderer: gl ? gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL) : null,
    brands: navigator.userAgentData.brands,
    full: (await navigator.userAgentData.getHighEntropyValues(["fullVersionList"])).fullVersionList,
    source: Function.prototype.toString.call(WebGLRenderingContext.prototype.getParameter),
  };
})()`;
type Probe = { renderer: string | null; brands: { brand: string; version: string }[]; full: unknown; source: string };

const frames = async (page: Page) => {
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.readyState === "complete");
  return Promise.all(page.frames().slice(0, 2).map((f) => f.evaluate(PROBE) as Promise<Probe>)) as Promise<[Probe, Probe]>;
};
const opener = (persistent?: { baseDir: string }) =>
  createPlainWindowOpener({ proxy, sandbox: !process.env.CI, headless: false, exposePage: true, persistent });
const disguises = () => readdirSync(tmpdir()).filter((n) => n.startsWith("sm-disguise-"));

describe.runIf(linux)("the stealth live window", () => {
  it("reports a real graphics card and Google Chrome's brands in the page and its frames, and removes the extension after", async () => {
    const before = disguises();
    const window = await opener()(url, { stealth: true });
    const full = (await chromeVersion(chromium.executablePath())) as string;
    const [main, frame] = await frames(window.page as Page);
    for (const seen of [main, frame]) {
      expect(seen.renderer).toBe("ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)");
      expect(seen.brands).toEqual(chromeBrands(full).map((b) => ({ brand: b.brand, version: b.version.split(".")[0] })));
      expect(seen.full).toEqual(chromeBrands(full));
      expect(seen.source).toBe("function getParameter() { [native code] }");
    }
    expect(header).toBe(secChUa(full));
    const made = disguises().filter((n) => !before.includes(n));
    expect(made).toHaveLength(1);
    await window.close();
    expect(existsSync(join(tmpdir(), made[0] as string))).toBe(false);
  });

  it("changes nothing without stealth, also on a kept profile a stealth window used before", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "disguise-profiles-"));
    try {
      const first = await opener({ baseDir })(url, { stealth: true });
      expect((await frames(first.page as Page))[0].renderer).toContain("UHD Graphics 620");
      await first.storageState(); // a clean quit, which writes the profile
      await first.close();
      const second = await opener({ baseDir })(url);
      const [main] = await frames(second.page as Page);
      expect(main.renderer).toBeNull(); // as today: no software WebGL, so no WebGL at all
      expect(main.brands.map((b) => b.brand)).not.toContain("Google Chrome");
      await second.close();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
