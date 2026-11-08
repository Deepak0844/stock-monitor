// The live login window against real Chromium (with no display, so it runs anywhere) and the fake supplier.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeSupplier, FAKE_PASSWORD, FAKE_USERNAME, type FakeSupplier } from "@stock-monitor/supplier-session/testing";
import { startBrowserService, type BrowserService } from "../src/service.js";

const TOKEN = "s".repeat(40);
let site: FakeSupplier;
let service: BrowserService;
let shortService: BrowserService;
let internal: Server;
let internalHits = 0;
let internalUrl = "";

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const options = () => ({
  token: TOKEN,
  port: 0,
  host: "127.0.0.1",
  headedWindows: false, // this machine may have no display. The container test shows the window for real.
  sandbox: !process.env.CI,
  guard: { allowHosts: [`127.0.0.1:${site.port}`] },
});

beforeAll(async () => {
  site = await createFakeSupplier();
  internal = createServer((_req, res) => {
    internalHits += 1;
    res.end("internal");
  });
  internalUrl = `http://127.0.0.1:${await listen(internal)}`;
  service = await startBrowserService(options());
  shortService = await startBrowserService({ ...options(), sessionTimeoutMs: 1200 });
}, 60_000);
afterAll(async () => {
  await shortService?.close();
  await service?.close();
  await site?.close();
  await new Promise((resolve) => internal?.close(resolve));
});
beforeEach(async () => {
  internalHits = 0;
  site.expireSessions();
  // Leave nothing open between tests.
  for (const s of [service, shortService]) if (s.loginPage()) await s.loginPage()?.context().browser()?.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
});

const call = (svc: BrowserService, method: string, path: string, body?: unknown) =>
  fetch(`${svc.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const open = async (svc = service, url = `${site.url}/login`) => {
  const res = await call(svc, "POST", "/sessions", { url });
  return { status: res.status, body: (await res.json()) as { id: string; expiresAt: string; error?: string; message?: string } };
};
const profiles = () => readdirSync(tmpdir()).filter((n) => n.startsWith("playwright_chromiumdev_profile")).sort();
const logInByHand = async (svc = service) => {
  const page = svc.loginPage();
  if (!page) throw new Error("no window");
  await page.getByLabel("Username").fill(FAKE_USERNAME);
  await page.getByLabel("Password").fill(FAKE_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/account");
  return page;
};

describe("a login saved by hand and used again", () => {
  it("opens the login page, takes a typed login, and returns the session with the supplier's cookie", async () => {
    const r = await open();
    expect(r.status).toBe(201);
    expect(r.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(service.loginPage()?.url()).toBe(`${site.url}/login`);
    await logInByHand();
    const res = await call(service, "POST", `/sessions/${r.body.id}/finish`);
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: { cookies: { name: string; value: string }[] } };
    expect(state.cookies.map((c) => c.name)).toContain("supplier_session");
    expect(service.loginPage()).toBeNull();
  });

  it("gives a session a fresh headless check can use to reach the account page", async () => {
    const r = await open();
    await logInByHand();
    const { state } = (await (await call(service, "POST", `/sessions/${r.body.id}/finish`)).json()) as { state: unknown };
    const check = await call(service, "POST", "/verify", { url: `${site.url}/account`, state });
    expect(await check.json()).toMatchObject({ result: "ok" });
  });

  it("never keeps the session in a file while the window is open", async () => {
    await open();
    await logInByHand();
    const value = (await service.loginPage()!.context().cookies()).find((c) => c.name === "supplier_session")!.value;
    const hits: string[] = [];
    const scan = (dir: string, depth = 0) => {
      if (depth > 8) return;
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        let info;
        try {
          info = statSync(p);
        } catch {
          continue;
        }
        if (info.isDirectory()) scan(p, depth + 1);
        else if (info.size < 50_000_000 && readFileSync(p).includes(value)) hits.push(p);
      }
    };
    for (const name of profiles()) scan(join(tmpdir(), name));
    expect(hits).toEqual([]);
  });
});

describe("one window at a time", () => {
  it("refuses a second window with a plain message, and the first keeps working", async () => {
    await open();
    const second = await open();
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "session_open", message: "A login window is already open. Finish or cancel it first." });
    await logInByHand();
  });

  it("starts fresh after a cancel: nothing from the cancelled window carries over", async () => {
    const a = await open();
    await logInByHand();
    const browser = service.loginPage()!.context().browser()!;
    expect((await call(service, "DELETE", `/sessions/${a.body.id}`)).status).toBe(204);
    expect(browser.isConnected()).toBe(false);
    expect(service.loginPage()).toBeNull();
    const b = await open();
    const { state } = (await (await call(service, "POST", `/sessions/${b.body.id}/finish`)).json()) as { state: { cookies: unknown[] } };
    expect(state.cookies).toEqual([]);
  });
});

describe("leaving nothing behind", () => {
  it("removes Chromium and its profile folder after finish, after cancel, and after the owner closes the window", async () => {
    const before = profiles();
    const handles: { isConnected(): boolean }[] = [];

    const a = await open();
    handles.push(service.loginPage()!.context().browser()!);
    expect(profiles().length).toBeGreaterThan(before.length); // a window really has a profile while open
    await call(service, "POST", `/sessions/${a.body.id}/finish`);

    const b = await open();
    handles.push(service.loginPage()!.context().browser()!);
    await call(service, "DELETE", `/sessions/${b.body.id}`);

    await open();
    const third = service.loginPage()!.context().browser()!;
    handles.push(third);
    await third.close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(handles.map((h) => h.isConnected())).toEqual([false, false, false]);
    expect(profiles()).toEqual(before);
    expect((await open()).status).toBe(201); // and the owner closing it freed the slot
  });

  it("closes the window and discards the session when the time runs out", async () => {
    const a = await open(shortService);
    const browser = shortService.loginPage()!.context().browser()!;
    await logInByHand(shortService);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(browser.isConnected()).toBe(false);
    expect((await call(shortService, "POST", `/sessions/${a.body.id}/finish`)).status).toBe(404);
    expect((await open(shortService)).status).toBe(201);
  });

  it("says there is no such window for an id that is not open", async () => {
    const res = await call(service, "POST", "/sessions/00000000-0000-4000-8000-000000000000/finish");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "session_not_found" });
  });
});

describe("the live window is as guarded as a check", () => {
  it("cannot be steered to a private address by typing one in", async () => {
    await open();
    const page = service.loginPage()!;
    const response = await page.goto(`${internalUrl}/hit`).catch(() => null);
    expect(response?.headers()["x-guard-blocked"] ?? "blocked").toBe("private");
    expect(internalHits).toBe(0);
  });

  it("cannot be sent to a private address by a redirect from the supplier", async () => {
    await open(service, `${site.url}/redirect-to?url=${encodeURIComponent(`${internalUrl}/hit`)}`);
    expect(internalHits).toBe(0);
  });

  it("is not reachable without the control token", async () => {
    const res = await fetch(`${service.url}/sessions`, { method: "POST", body: JSON.stringify({ url: `${site.url}/login` }) });
    expect(res.status).toBe(401);
    expect(service.loginPage()).toBeNull();
  });
});
