// SPIKE: the login window keeps one profile per supplier site between logins. Real Chromium, fake supplier, Linux only.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeSupplier, FAKE_PASSWORD, FAKE_USERNAME, type FakeSupplier } from "@stock-monitor/supplier-session/testing";
import { startBrowserService, type BrowserService } from "../src/service.js";
import { cookieHash, profileDirFor } from "../src/profile-store.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const linux = process.platform === "linux";
const TOKEN = "p".repeat(40);
let site: FakeSupplier;
let svc: BrowserService;
let dir: string;

beforeAll(async () => {
  if (!linux) return;
  dir = mkdtempSync(join(tmpdir(), "sm-test-login-profiles-"));
  site = await createFakeSupplier();
  svc = await startBrowserService({
    token: TOKEN, port: 0, host: "127.0.0.1", headedWindows: false, sandbox: !process.env.CI,
    loginWindowMode: "plain", loginProfile: "persistent", verifyMode: "profile", exposePageForTests: true,
    profileSettleMs: 3000, profileDir: dir, guard: { allowHosts: [`127.0.0.1:${site.port}`] },
  });
});
afterAll(async () => {
  await svc?.close();
  await site?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${svc.url}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const openWindow = async () => ((await (await call("POST", "/sessions", { url: `${site.url}/login` })).json()) as { id: string }).id;
const logIn = async () => {
  const page = svc.loginPage()!;
  await page.getByLabel("Username").fill(FAKE_USERNAME);
  await page.getByLabel("Password").fill(FAKE_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/account");
};
const check = async (state: unknown) =>
  (await (await call("POST", "/verify", { url: `${site.url}/account`, state })).json()) as { result: string };
const profile = () => profileDirFor(dir, `${site.url}/login`);

describe.skipIf(!linux)("a login window with a kept profile (spike)", () => {
  let state: { cookies: { name: string; value: string; domain: string; path: string }[] };

  it("keeps the profile after finishing, and says which session it holds", async () => {
    const id = await openWindow();
    await logIn();
    const res = await call("POST", `/sessions/${id}/finish`);
    state = ((await res.json()) as { state: typeof state }).state;
    expect(state.cookies.some((c) => c.name === "supplier_session")).toBe(true);
    expect(existsSync(profile())).toBe(true);
    expect(readFileSync(join(profile(), "seeded"), "utf8")).toBe(cookieHash(state.cookies));
  });

  it("lets the next check use that profile as it is, without wiping it", async () => {
    writeFileSync(join(profile(), "keep-me"), "history");
    expect((await check(state)).result).toBe("ok");
    expect(existsSync(join(profile(), "keep-me"))).toBe(true);
  });

  it("opens the next login in the same profile, and keeps it again after a cancel", async () => {
    const id = await openWindow();
    expect(existsSync(join(profile(), "keep-me"))).toBe(true);
    await call("DELETE", `/sessions/${id}`);
    expect(existsSync(join(profile(), "keep-me"))).toBe(true);
  });

  it("answers a check as unreachable, and changes nothing, while the owner is logging in to that site", async () => {
    const id = await openWindow();
    expect((await check(state)).result).toBe("unreachable");
    await call("DELETE", `/sessions/${id}`);
  });
});
