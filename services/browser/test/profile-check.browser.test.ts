// SPIKE: the persistent-profile check against real Chromium and the fake supplier. Linux only, like the plain window.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeSupplier, FAKE_PASSWORD, FAKE_USERNAME, type FakeSupplier } from "@stock-monitor/supplier-session/testing";
import { startBrowserService, type BrowserService } from "../src/service.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const linux = process.platform === "linux";
const TOKEN = "p".repeat(40);
let site: FakeSupplier;
let svc: BrowserService;
let dir: string;

beforeAll(async () => {
  if (!linux) return;
  dir = mkdtempSync(join(tmpdir(), "sm-test-profiles-"));
  site = await createFakeSupplier();
  svc = await startBrowserService({
    token: TOKEN, port: 0, host: "127.0.0.1", headedWindows: false, sandbox: !process.env.CI,
    verifyMode: "profile", profileSettleMs: 3000, profileDir: dir,
    guard: { allowHosts: [`127.0.0.1:${site.port}`] },
  });
});
afterAll(async () => {
  await svc?.close();
  await site?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const login = async () => {
  const res = await fetch(`${site.url}/login`, {
    method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: FAKE_USERNAME, password: FAKE_PASSWORD }),
  });
  const value = /supplier_session=([0-9a-f]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  return { cookies: [{ name: "supplier_session", value, domain: new URL(site.url).hostname, path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] };
};
const verify = async (path: string, state: unknown) =>
  (await (await fetch(`${svc.url}/verify`, {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ url: `${site.url}${path}`, state }),
  })).json()) as { result: string; status: number | null };

describe.skipIf(!linux)("profile check (spike)", () => {
  it("reaches a page that needs the login, using the saved cookies from an ordinary browser", async () => {
    const state = await login();
    expect(await verify("/account", state)).toMatchObject({ result: "ok", status: null });
  });
  it("keeps the profile for the next check while the session is unchanged", async () => {
    const state = await login();
    await verify("/account", state);
    const before = site.requests.length;
    expect((await verify("/account", state)).result).toBe("ok");
    expect(site.requests.length).toBeGreaterThan(before);
    expect(existsSync(dir)).toBe(true);
  });
  it("sends a person with no session to the login page", async () => {
    expect((await verify("/account", { cookies: [], origins: [] })).result).toBe("login_required");
  });
  it("sees a challenge page", async () => {
    expect((await verify("/captcha", await login())).result).toBe("captcha");
  });
});
