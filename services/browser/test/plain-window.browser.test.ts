// The plain login window against real Chromium and the fake supplier. Nothing controls this browser while the person
// uses it. A test-only option attaches the test to it so a test can type, because a test has no mouse.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createFakeSupplier,
  FAKE_PASSWORD,
  FAKE_USERNAME,
  type FakeSupplier,
} from "@stock-monitor/supplier-session/testing";
import { startBrowserService, type BrowserService } from "../src/service.js";

vi.setConfig({ testTimeout: 30_000 });
// The plain window runs on Linux, where the service runs. On other machines these tests run in the container tests instead.
const linux = process.platform === "linux";
const run = promisify(execFile);
const TOKEN = "p".repeat(40);
let site: FakeSupplier;
let internal: Server;
let internalHits = 0;
let internalUrl = "";
const services: BrowserService[] = [];

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
const start = async (over: Partial<Parameters<typeof startBrowserService>[0]> = {}) => {
  const s = await startBrowserService({
    token: TOKEN,
    port: 0,
    host: "127.0.0.1",
    headedWindows: false, // this machine may have no display
    sandbox: !process.env.CI,
    loginWindowMode: "plain",
    guard: { allowHosts: [`127.0.0.1:${site.port}`] },
    ...over,
  });
  services.push(s);
  return s;
};
let plain: BrowserService;
let hidden: BrowserService; // plain, with nothing attached for the tests

beforeAll(async () => {
  if (!linux) return;
  site = await createFakeSupplier();
  internal = createServer((_req, res) => {
    internalHits += 1;
    res.end("internal");
  });
  internalUrl = `http://127.0.0.1:${await listen(internal)}`;
  plain = await start({ exposePageForTests: true });
  hidden = await start();
}, 60_000);
afterAll(async () => {
  for (const s of services) await s.close();
  await site?.close();
  await new Promise((resolve) => internal?.close(resolve));
});
const opened: { svc: BrowserService; id: string }[] = [];
beforeEach(async () => {
  if (!linux) return;
  internalHits = 0;
  site.expireSessions();
  site.requests.length = 0;
  for (const { svc, id } of opened.splice(0)) await call(svc, "DELETE", `/sessions/${id}`); // no window outlives its test
});

const call = (svc: BrowserService, method: string, path: string, body?: unknown) =>
  fetch(`${svc.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const open = async (svc: BrowserService, url: string) => {
  const res = await call(svc, "POST", "/sessions", { url });
  const body = (await res.json()) as { id: string };
  if (res.status === 201) opened.push({ svc, id: body.id });
  return { status: res.status, body };
};
const profiles = () => readdirSync(tmpdir()).filter((n) => n.startsWith("sm-plain-"));
const processesUsing = async (profile: string) => {
  try {
    return (await run("pgrep", ["-f", profile])).stdout.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0; // pgrep says nothing found
  }
};
const until = async (check: () => boolean | Promise<boolean>, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};
const logIn = async (svc: BrowserService) => {
  const page = svc.loginPage()!;
  await page.getByLabel("Username").fill(FAKE_USERNAME);
  await page.getByLabel("Password").fill(FAKE_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/account");
};

describe.skipIf(!linux)("a login saved by hand and used again, in the plain window", () => {
  it("takes a typed login, returns the session with the supplier's cookie, and a fresh check reaches the account page", async () => {
    const r = await open(plain, `${site.url}/login`);
    expect(r.status).toBe(201);
    await logIn(plain);
    const res = await call(plain, "POST", `/sessions/${r.body.id}/finish`);
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: { cookies: { name: string }[] } };
    expect(state.cookies.map((c) => c.name)).toContain("supplier_session");
    const check = await call(plain, "POST", "/verify", { url: `${site.url}/account`, state });
    expect(await check.json()).toMatchObject({ result: "ok" });
  });

  it("returns an empty session when nothing was logged in, and does not invent one", async () => {
    const r = await open(hidden, `${site.url}/login`);
    const { state } = (await (
      await call(hidden, "POST", `/sessions/${r.body.id}/finish`)
    ).json()) as { state: { cookies: unknown[] } };
    expect(state.cookies).toEqual([]);
  });
});

describe.skipIf(!linux)("nothing controls the browser while the person uses it", () => {
  it("tells the page that it is not being driven, with no test attached, and the controlled window says it is", async () => {
    const r = await open(hidden, `${site.url}/webdriver-report`);
    expect(await until(() => site.requests.some((q) => q.path.startsWith("/seen/")))).toBe(true);
    expect(site.requests.filter((q) => q.path.startsWith("/seen/")).map((q) => q.path)).toEqual([
      "/seen/false",
    ]);
    await call(hidden, "DELETE", `/sessions/${r.body.id}`);

    site.requests.length = 0;
    const controlled = await start({ loginWindowMode: "controlled" });
    const c = await open(controlled, `${site.url}/webdriver-report`);
    expect(await until(() => site.requests.some((q) => q.path.startsWith("/seen/")))).toBe(true);
    expect(site.requests.filter((q) => q.path.startsWith("/seen/")).map((q) => q.path)).toEqual([
      "/seen/true",
    ]);
    await call(controlled, "DELETE", `/sessions/${c.body.id}`);
  });
});

describe.skipIf(!linux)("the plain window is as guarded as the controlled one", () => {
  it("cannot be steered to a private address by typing one in", async () => {
    await open(plain, `${site.url}/login`);
    // Chromium shows its own error page for the guard's refusal, so the navigation fails.
    await expect(plain.loginPage()!.goto(`${internalUrl}/hit`)).rejects.toThrow(
      /ERR_HTTP_RESPONSE_CODE_FAILURE|ERR_/,
    );
    expect(internalHits).toBe(0);
  });

  it("cannot be sent to a private address by a redirect from the supplier", async () => {
    await open(plain, `${site.url}/redirect-to?url=${encodeURIComponent(`${internalUrl}/hit`)}`);
    await new Promise((r) => setTimeout(r, 800));
    expect(internalHits).toBe(0);
  });

  it("cannot reach the browser's debugging channel from a page, because loopback is refused", async () => {
    const before = profiles();
    await open(plain, `${site.url}/login`);
    const profile = join(
      tmpdir(),
      profiles().find((p) => !before.includes(p))!,
    );
    const port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
    const reached = await plain.loginPage()!.evaluate(async (p) => {
      try {
        return (await fetch(`http://127.0.0.1:${p}/json/version`)).status;
      } catch {
        return "blocked";
      }
    }, port);
    expect(reached).toBe("blocked");
  });
});

describe.skipIf(!linux)("leaving nothing behind", () => {
  it("removes the browser and its profile folder after finish, cancel, time out and the owner closing the window", async () => {
    const before = profiles();
    const seen: string[] = [];

    const a = await open(hidden, `${site.url}/login`);
    const created = profiles().filter((p) => !before.includes(p));
    expect(created).toHaveLength(1); // a window really has a profile while open
    const profile = join(tmpdir(), created[0]!);
    seen.push(profile);
    expect(await processesUsing(profile)).toBeGreaterThan(0);
    await call(hidden, "POST", `/sessions/${a.body.id}/finish`);
    expect(await until(async () => (await processesUsing(profile)) === 0)).toBe(true);

    const b = await open(hidden, `${site.url}/login`);
    const bProfile = join(tmpdir(), profiles().filter((p) => !before.includes(p))[0]!);
    await call(hidden, "DELETE", `/sessions/${b.body.id}`);
    expect(await until(async () => (await processesUsing(bProfile)) === 0)).toBe(true);

    expect(await until(() => profiles().length === before.length)).toBe(true);
  });

  it("closes the window and removes its profile when the time runs out", async () => {
    const short = await start({ sessionTimeoutMs: 1200 });
    const before = profiles();
    await open(short, `${site.url}/login`);
    expect(profiles().length).toBe(before.length + 1);
    expect(await until(() => profiles().length === before.length, 6000)).toBe(true);
    expect((await open(short, `${site.url}/login`)).status).toBe(201);
  });

  it("frees the slot when the owner closes the browser window themselves", async () => {
    const before = profiles();
    await open(plain, `${site.url}/login`);
    const mine = join(
      tmpdir(),
      profiles().find((p) => !before.includes(p))!,
    );
    await run("pkill", ["-INT", "-f", `user-data-dir=${mine}`]).catch(() => {}); // the person closes the window
    expect(
      await until(async () => (await open(plain, `${site.url}/login`)).status === 201, 8000),
    ).toBe(true);
    expect(await until(() => profiles().length <= before.length + 1)).toBe(true);
  });
});

describe.skipIf(!linux)("what the profile may hold", () => {
  it("keeps no typed password anywhere in the profile, and keeps the saving of passwords off", async () => {
    const before = profiles();
    await open(plain, `${site.url}/login`);
    await logIn(plain);
    const profile = join(
      tmpdir(),
      profiles().find((p) => !before.includes(p))!,
    );
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
        else if (info.isFile() && info.size < 50_000_000 && readFileSync(p).includes(FAKE_PASSWORD))
          hits.push(p);
      }
    };
    scan(profile);
    expect(hits).toEqual([]);
    const prefs = JSON.parse(readFileSync(join(profile, "Default", "Preferences"), "utf8"));
    expect(prefs.credentials_enable_service).toBe(false);
  });
});
