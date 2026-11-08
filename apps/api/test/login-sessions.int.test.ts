import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createLoginSessionRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { unsealSessionState } from "@stock-monitor/supplier-session";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";
import { createBrowserClient } from "../src/browser-client.js";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN, type FakeBrowserService } from "./fake-browser-service.js";

let t: TestDb;
let fake: FakeBrowserService;
let sid: string;
let userId: string;
const key = { key: randomBytes(32), keyId: "v1" };
const logLines: string[] = [];
const bodies: string[] = [];
const logger = createLogger({ level: "debug", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });

const COOKIE = "COOKIE-SECRET-MARKER-5e2b";
const STORAGE = "LOCALSTORAGE-SECRET-MARKER-9c4d";
const VNC = "Zq7Lm2Pw";
const sessionState = { cookies: [{ name: "session", value: COOKIE, domain: "shop.acme.example", path: "/" }], origins: [{ origin: "https://shop.acme.example", localStorage: [{ name: "auth", value: STORAGE }] }] };

const supplierRepo = () => createSupplierRepository(t.appDb);
const loginRepo = () => createLoginSessionRepository(t.appDb);
const sessionRepo = () => createSupplierSessionRepository(t.appDb);
const app = (over: { browserUrl?: string; encryptionKey?: Buffer } = {}) =>
  buildApp({
    db: t.appDb,
    logger,
    suppliers: { repo: supplierRepo(), lookup: async () => ["93.184.216.34"] },
    loginSessions: {
      suppliers: supplierRepo(),
      loginSessions: loginRepo(),
      supplierSessions: sessionRepo(),
      browser: createBrowserClient({ baseUrl: over.browserUrl ?? fake.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 2000 }),
      key: { key: over.encryptionKey ?? key.key, keyId: key.keyId },
    },
  });
// One app is reused, because the API keeps each attempt's VNC password in memory between calls.
let shared: ReturnType<typeof app>;

type Method = "GET" | "POST" | "DELETE";
async function call(method: Method, url: string, cookie = true, a = shared) {
  const res = await a.inject({ method, url, cookies: cookie ? { sid } : {} });
  bodies.push(res.body);
  return { status: res.statusCode, body: res.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

let acme = "";
let globex = "";
beforeAll(async () => {
  t = await startTestDb();
  fake = await createFakeBrowserService();
  userId = (await t.pool.query("insert into users (email, password_hash) values ('owner@example.com', 'h') returning id")).rows[0].id;
  sid = randomBytes(32).toString("hex");
  await t.pool.query("insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [userId, createHash("sha256").update(sid).digest("hex")]);
  shared = app();
}, 180_000);
afterAll(async () => {
  await fake?.close();
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate login_sessions, suppliers, audit_events cascade");
  fake.requests.length = 0;
  logLines.length = 0;
  bodies.length = 0;
  Object.assign(fake.behaviour, { open: "ok", finish: "ok", cancel: "ok", state: sessionState, vncPassword: VNC, delayMs: 0 });
  const a = await supplierRepo().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: "https://shop.acme.example/login", checkIntervalMinutes: 60 });
  const g = await supplierRepo().create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!a.ok || !g.ok) throw new Error("setup");
  acme = a.supplier.id;
  globex = g.supplier.id;
});

const audit = async (action: string) => (await t.pool.query("select actor_user_id, entity_type, entity_id, details from audit_events where action = $1", [action])).rows;
const start = async (supplier = acme) => {
  const r = await call("POST", `/api/suppliers/${supplier}/login-session`);
  expect(r.status).toBe(201);
  return { id: r.body.loginSession.id as string, token: r.body.token as string };
};
const row = async (id: string) => (await t.pool.query("select status, failure_reason from login_sessions where id = $1", [id])).rows[0] as { status: string; failure_reason: string | null };
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("every login route needs a signed-in owner", () => {
  it.each([
    ["POST", `/api/suppliers/${UNKNOWN}/login-session`],
    ["GET", `/api/login-sessions/${UNKNOWN}`],
    ["POST", `/api/login-sessions/${UNKNOWN}/finish`],
    ["POST", `/api/login-sessions/${UNKNOWN}/cancel`],
    ["GET", `/api/suppliers/${UNKNOWN}/session`],
    ["DELETE", `/api/suppliers/${UNKNOWN}/session`],
  ] as const)("%s %s returns 401 without a session and reaches nothing", async (method, url) => {
    expect((await call(method, url, false)).status).toBe(401);
    expect(fake.requests).toHaveLength(0);
  });
});

describe("starting a login", () => {
  it("opens a window at the supplier's login address, and returns the attempt and a one-time token", async () => {
    const r = await call("POST", `/api/suppliers/${acme}/login-session`);
    expect(r.status).toBe(201);
    expect(r.body.loginSession).toMatchObject({ supplierId: acme, status: "ready", createdAt: expect.any(String), tokenExpiresAt: expect.any(String), expiresAt: expect.any(String) });
    expect(r.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(r.body).sort()).toEqual(["loginSession", "token"]);
    expect(fake.requests[0]).toMatchObject({ method: "POST", path: "/sessions", auth: `Bearer ${FAKE_CONTROL_TOKEN}`, body: { url: "https://shop.acme.example/login" } });
  });

  it("falls back to the website address when there is no login address", async () => {
    await start(globex);
    expect(fake.requests[0]?.body).toEqual({ url: "https://globex.example/" });
  });

  it("keeps only a hash of the token, and never shows the VNC password", async () => {
    const { id, token } = await start();
    const raw = JSON.stringify((await t.pool.query("select * from login_sessions")).rows);
    expect(raw).not.toContain(token);
    const view = await call("GET", `/api/login-sessions/${id}`);
    expect(JSON.stringify(view.body)).not.toMatch(new RegExp(`${token}|${VNC}|token_hash|tokenHash`));
  });

  it("records who started it, and writes an audit event with no secret", async () => {
    const { id, token } = await start();
    const [event] = await audit("login_session.started");
    expect(event).toMatchObject({ actor_user_id: userId, entity_type: "login_session", entity_id: id, details: { supplierId: acme } });
    expect(JSON.stringify(event)).not.toContain(token);
    expect((await t.pool.query("select started_by from login_sessions where id = $1", [id])).rows[0].started_by).toBe(userId);
  });

  it("gives a plain 404 for a supplier that does not exist", async () => {
    const r = await call("POST", `/api/suppliers/${UNKNOWN}/login-session`);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatchObject({ code: "supplier_not_found", message: "That supplier does not exist." });
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses a second login while one is open, in plain words, without bothering the browser", async () => {
    await start(acme);
    fake.requests.length = 0;
    const r = await call("POST", `/api/suppliers/${globex}/login-session`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "login_open", message: "A login window is already open. Finish or cancel it first." });
    expect(fake.requests).toHaveLength(0);
  });

  it("when the browser says a window is already open, fails the attempt and lets the next try work", async () => {
    fake.behaviour.open = "busy";
    const r = await call("POST", `/api/suppliers/${acme}/login-session`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("login_open");
    expect((await t.pool.query("select status, failure_reason from login_sessions")).rows).toEqual([{ status: "failed", failure_reason: "window_already_open" }]);
    fake.behaviour.open = "ok";
    expect((await call("POST", `/api/suppliers/${acme}/login-session`)).status).toBe(201);
  });

  it("says plainly when the window could not start, or the browser service is down, and keeps the reason code", async () => {
    fake.behaviour.open = "fail";
    const failed = await call("POST", `/api/suppliers/${acme}/login-session`);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatchObject({ code: "window_failed", message: "The login window could not be opened. Please try again." });
    const down = await call("POST", `/api/suppliers/${acme}/login-session`, true, app({ browserUrl: "http://127.0.0.1:1" }));
    expect(down.status).toBe(503);
    expect(down.body.error).toMatchObject({ code: "browser_unavailable", message: "The browser service is not available right now. Please try again in a minute." });
    expect((await t.pool.query("select failure_reason from login_sessions order by created_at")).rows.map((r) => r.failure_reason)).toEqual(["window_failed", "browser_unavailable"]);
    expect(await audit("login_session.failed")).toHaveLength(2);
  });

  it("clears an attempt whose time ran out, and closes its window, before starting a new one", async () => {
    const old = await start(acme);
    await t.pool.query("update login_sessions set expires_at = now() - interval '1 second' where id = $1", [old.id]);
    fake.requests.length = 0;
    expect((await call("POST", `/api/suppliers/${globex}/login-session`)).status).toBe(201);
    expect(fake.requests.map((r) => `${r.method} ${r.path.replace(/[0-9a-f-]{36}/, ":id")}`)).toEqual(["DELETE /sessions/:id", "POST /sessions"]);
    expect((await row(old.id)).status).toBe("expired");
  });
});

describe("reading a login", () => {
  it("shows the attempt's status and never its token", async () => {
    const { id } = await start();
    const r = await call("GET", `/api/login-sessions/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.loginSession).toMatchObject({ id, status: "ready" });
  });
  it("shows an attempt that has run out of time as expired", async () => {
    const { id } = await start();
    await t.pool.query("update login_sessions set expires_at = now() - interval '1 second' where id = $1", [id]);
    expect((await call("GET", `/api/login-sessions/${id}`)).body.loginSession.status).toBe("expired");
  });
  it("gives a plain 404 for an unknown or malformed id", async () => {
    for (const id of [UNKNOWN, "not-an-id"]) {
      const r = await call("GET", `/api/login-sessions/${id}`);
      expect(r.status).toBe(404);
      expect(r.body.error).toMatchObject({ code: "login_session_not_found", message: "That login does not exist." });
    }
  });
});

describe("finishing a login", () => {
  it("saves the session sealed, connects the supplier and ends the attempt", async () => {
    const { id } = await start();
    const r = await call("POST", `/api/login-sessions/${id}/finish`);
    expect(r.status).toBe(200);
    expect(r.body.loginSession).toMatchObject({ id, status: "finished" });
    expect(r.body.session).toMatchObject({ cookieCount: 1, domains: ["shop.acme.example"], savedAt: expect.any(String) });
    expect(fake.requests.at(-1)).toMatchObject({ method: "POST", path: expect.stringMatching(/^\/sessions\/[0-9a-f-]{36}\/finish$/) });

    expect((await supplierRepo().get(acme))?.sessionStatus).toBe("connected");
    const sealed = await sessionRepo().getSealed(acme);
    expect(unsealSessionState(sealed!, key.key)).toEqual(sessionState); // what was saved is what the window had
    expect((await row(id)).status).toBe("finished");
  });

  it("never returns, stores or logs the session, the token or the VNC password anywhere readable", async () => {
    const { id, token } = await start();
    await call("POST", `/api/login-sessions/${id}/finish`);
    await call("GET", `/api/login-sessions/${id}`);
    await call("GET", `/api/suppliers/${acme}/session`);
    const everything = [
      ...bodies.filter((b) => !b.includes(`"token":"${token}"`)), // the start answer is the one place the token is handed over
      ...logLines,
      JSON.stringify((await t.pool.query("select * from audit_events")).rows),
      JSON.stringify((await t.pool.query("select * from login_sessions")).rows),
      JSON.stringify((await t.pool.query("select * from supplier_sessions")).rows),
    ].join("\n");
    for (const secret of [COOKIE, STORAGE, VNC, token]) expect(everything, secret).not.toContain(secret);
  });

  it("writes an audit event with the facts and no contents", async () => {
    const { id } = await start();
    await call("POST", `/api/login-sessions/${id}/finish`);
    const [event] = await audit("login_session.finished");
    expect(event).toMatchObject({ actor_user_id: userId, entity_id: id, details: { supplierId: acme, savedItems: 1 } });
  });

  it("lifts a pause the app made, but never one the owner made", async () => {
    await t.pool.query("update suppliers set session_status = 'needs_reconnect', enabled = false, paused_reason = 'session' where id = $1", [acme]);
    await supplierRepo().pause(globex);
    const a = await start(acme);
    await call("POST", `/api/login-sessions/${a.id}/finish`);
    expect(await supplierRepo().get(acme)).toMatchObject({ enabled: true, pausedReason: null, sessionStatus: "connected" });
    const g = await start(globex);
    await call("POST", `/api/login-sessions/${g.id}/finish`);
    expect(await supplierRepo().get(globex)).toMatchObject({ enabled: false, pausedReason: "owner", sessionStatus: "connected" });
  });

  it("replaces an older saved session when the supplier is connected again", async () => {
    const first = await start();
    await call("POST", `/api/login-sessions/${first.id}/finish`);
    fake.behaviour.state = { cookies: [{ name: "session", value: "NEW-VALUE", domain: "new.acme.example", path: "/" }], origins: [] };
    const second = await start();
    await call("POST", `/api/login-sessions/${second.id}/finish`);
    expect((await sessionRepo().facts(acme))?.domains).toEqual(["new.acme.example"]);
    expect((await t.pool.query("select count(*)::int as n from supplier_sessions")).rows[0].n).toBe(1);
  });

  it("can be done once only", async () => {
    const { id } = await start();
    await call("POST", `/api/login-sessions/${id}/finish`);
    const again = await call("POST", `/api/login-sessions/${id}/finish`);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "login_not_open", message: "This login is no longer open. Start the login again." });
  });

  it("saves nothing, and says so, when the window held no login", async () => {
    fake.behaviour.state = { cookies: [], origins: [] };
    const { id } = await start();
    const r = await call("POST", `/api/login-sessions/${id}/finish`);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "nothing_to_save", message: "No login was found in the window. Log in to the supplier, then press I'm logged in. Start the login again to try again." });
    expect(await sessionRepo().facts(acme)).toBeNull();
    expect((await supplierRepo().get(acme))?.sessionStatus).toBe("not_connected");
    expect(await row(id)).toEqual({ status: "failed", failure_reason: "save_failed" });
  });

  it("says the window has closed when the browser no longer has it, and saves nothing", async () => {
    const { id } = await start();
    fake.behaviour.finish = "gone";
    const r = await call("POST", `/api/login-sessions/${id}/finish`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "login_window_closed", message: "The login window has closed. Start the login again." });
    expect(await row(id)).toEqual({ status: "failed", failure_reason: "window_failed" });
    expect(await sessionRepo().facts(acme)).toBeNull();
  });

  it("says plainly when the session could not be read, or the service is down, and saves nothing", async () => {
    const a = await start();
    fake.behaviour.finish = "fail";
    const failed = await call("POST", `/api/login-sessions/${a.id}/finish`);
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe("read_failed");
    expect(await row(a.id)).toEqual({ status: "failed", failure_reason: "read_failed" });
    const b = await start();
    const down = await call("POST", `/api/login-sessions/${b.id}/finish`, true, app({ browserUrl: "http://127.0.0.1:1" }));
    expect(down.status).toBe(503);
    expect(await row(b.id)).toEqual({ status: "failed", failure_reason: "browser_unavailable" });
    expect(await sessionRepo().facts(acme)).toBeNull();
  });

  it("fails cleanly, keeping nothing, when the session cannot be sealed", async () => {
    const { id } = await start();
    const r = await call("POST", `/api/login-sessions/${id}/finish`, true, app({ encryptionKey: Buffer.alloc(5) }));
    expect(r.status).toBe(500);
    expect(r.body.error).toMatchObject({ code: "save_failed", message: "The login could not be saved. Start the login again." });
    expect(await row(id)).toEqual({ status: "failed", failure_reason: "save_failed" });
    expect(await sessionRepo().facts(acme)).toBeNull();
    expect((await supplierRepo().get(acme))?.sessionStatus).toBe("not_connected");
  });

  it("gives a plain 404 for an unknown attempt", async () => {
    expect((await call("POST", `/api/login-sessions/${UNKNOWN}/finish`)).status).toBe(404);
  });
});

describe("cancelling a login", () => {
  it("closes the window, ends the attempt and saves nothing", async () => {
    const { id } = await start();
    const r = await call("POST", `/api/login-sessions/${id}/cancel`);
    expect(r.status).toBe(200);
    expect(r.body.loginSession).toMatchObject({ id, status: "cancelled" });
    expect(fake.requests.at(-1)).toMatchObject({ method: "DELETE" });
    expect(await sessionRepo().facts(acme)).toBeNull();
    expect(await audit("login_session.cancelled")).toHaveLength(1);
    expect((await call("POST", `/api/suppliers/${globex}/login-session`)).status).toBe(201); // and the next login can start
  });

  it("is harmless to repeat, and does not undo a finished login", async () => {
    const a = await start();
    await call("POST", `/api/login-sessions/${a.id}/cancel`);
    expect((await call("POST", `/api/login-sessions/${a.id}/cancel`)).body.loginSession.status).toBe("cancelled");
    const b = await start();
    await call("POST", `/api/login-sessions/${b.id}/finish`);
    const late = await call("POST", `/api/login-sessions/${b.id}/cancel`);
    expect(late.status).toBe(200);
    expect(late.body.loginSession.status).toBe("finished");
    expect((await supplierRepo().get(acme))?.sessionStatus).toBe("connected");
  });

  it("still ends the attempt when the browser cannot be reached", async () => {
    const { id } = await start();
    const r = await call("POST", `/api/login-sessions/${id}/cancel`, true, app({ browserUrl: "http://127.0.0.1:1" }));
    expect(r.status).toBe(200);
    expect(r.body.loginSession.status).toBe("cancelled");
  });

  it("gives a plain 404 for an unknown attempt", async () => {
    expect((await call("POST", `/api/login-sessions/${UNKNOWN}/cancel`)).status).toBe(404);
  });
});

describe("disconnecting and deleting a supplier", () => {
  it("shows plain facts about a saved session, and none when there is none", async () => {
    expect((await call("GET", `/api/suppliers/${acme}/session`)).body).toEqual({ session: null });
    const { id } = await start();
    await call("POST", `/api/login-sessions/${id}/finish`);
    const r = await call("GET", `/api/suppliers/${acme}/session`);
    expect(r.body.session).toMatchObject({ cookieCount: 1, domains: ["shop.acme.example"] });
    expect(Object.keys(r.body.session).sort()).toEqual(["cookieCount", "domains", "lastVerifiedAt", "savedAt", "sizeBytes"]);
  });

  it("removes the saved session and marks the supplier not connected", async () => {
    const { id } = await start();
    await call("POST", `/api/login-sessions/${id}/finish`);
    expect((await call("DELETE", `/api/suppliers/${acme}/session`)).body).toEqual({ ok: true });
    expect(await sessionRepo().facts(acme)).toBeNull();
    expect((await supplierRepo().get(acme))?.sessionStatus).toBe("not_connected");
    expect(await audit("supplier.disconnected")).toEqual([expect.objectContaining({ actor_user_id: userId, entity_id: acme })]);
    expect((await call("DELETE", `/api/suppliers/${acme}/session`)).status).toBe(404);
  });

  it("gives a plain 404 for an unknown supplier", async () => {
    for (const method of ["GET", "DELETE"] as const) {
      const r = await call(method, `/api/suppliers/${UNKNOWN}/session`);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("supplier_not_found");
    }
  });
});

describe("deleting a supplier that has a login open", () => {
  it("closes the window first, and a new login can start afterwards", async () => {
    const { id } = await start(acme);
    fake.requests.length = 0;
    expect((await call("DELETE", `/api/suppliers/${acme}`)).status).toBe(200);
    expect(fake.requests.map((r) => r.method)).toEqual(["DELETE"]);
    expect(await loginRepo().get(id)).toBeNull();
    expect((await call("POST", `/api/suppliers/${globex}/login-session`)).status).toBe(201);
  });

  it("leaves another supplier's open login alone", async () => {
    const { id } = await start(globex);
    fake.requests.length = 0;
    expect((await call("DELETE", `/api/suppliers/${acme}`)).status).toBe(200);
    expect(fake.requests).toHaveLength(0);
    expect((await row(id)).status).toBe("ready");
  });
});
