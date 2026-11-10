import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import WebSocket from "ws";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createLoginSessionRepository, createNotificationRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";
import { createBrowserClient } from "@stock-monitor/browser-client";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN, type FakeBrowserService } from "@stock-monitor/browser-client/testing";

const ORIGIN = "http://localhost:3000";
const VNC_PASSWORD = "Zq7Lm2Pw";
const MARKER = "SCREEN-BYTES-MARKER-6d1f";

let t: TestDb;
let fake: FakeBrowserService;
let app: ReturnType<typeof buildApp>;
let wsBase = "";
let sid = "";
let userId = "";
let vnc: Server;
let vncPort = 0;
let vncConnections = 0;
let vncReceived: Buffer[] = [];
let vncSockets: Socket[] = [];
const logLines: string[] = [];
const logger = createLogger({ level: "debug", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });
const key = { key: randomBytes(32), keyId: "v1" };
const supplierRepo = () => createSupplierRepository(t.appDb);
const loginRepo = () => createLoginSessionRepository(t.appDb);

beforeAll(async () => {
  t = await startTestDb();
  fake = await createFakeBrowserService();
  userId = (await t.pool.query("insert into users (email, password_hash) values ('owner@example.com', 'h') returning id")).rows[0].id;
  sid = randomBytes(32).toString("hex");
  await t.pool.query("insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [userId, createHash("sha256").update(sid).digest("hex")]);

  // A stand-in VNC server: it speaks first, like the real one, then echoes what it is sent.
  vnc = createServer((socket) => {
    vncConnections += 1;
    vncSockets.push(socket);
    socket.write("RFB 003.008\n");
    socket.on("data", (d: Buffer) => {
      vncReceived.push(d);
      socket.write(Buffer.concat([Buffer.from("echo:"), d]));
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => vnc.listen(0, "127.0.0.1", resolve));
  vncPort = (vnc.address() as AddressInfo).port;

}, 180_000);
afterAll(async () => {
  for (const s of vncSockets) s.destroy();
  await new Promise((resolve) => vnc?.close(resolve));
  await fake?.close();
  await t?.stop();
});

let supplier = "";
beforeEach(async () => {
  await t.pool.query("truncate login_sessions, suppliers, audit_events cascade");
  vncConnections = 0;
  vncReceived = [];
  logLines.length = 0;
  Object.assign(fake.behaviour, { open: "ok", finish: "ok", cancel: "ok", vncPassword: VNC_PASSWORD, state: { cookies: [], origins: [] } });
  const s = await supplierRepo().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  supplier = s.supplier.id;
  // A fresh app for each test, so one test's refusals (counted in memory) cannot block the next.
  app = buildApp({
    db: t.appDb,
    logger,
    suppliers: { repo: supplierRepo(), lookup: async () => ["93.184.216.34"] },
    loginSessions: {
      suppliers: supplierRepo(),
      loginSessions: loginRepo(),
      supplierSessions: createSupplierSessionRepository(t.appDb),
      browser: createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 2000 }),
      key,
      notifications: createNotificationRepository(t.appDb),
      queue: { enqueue: async () => {} },
    },
    loginScreen: { allowedOrigins: [ORIGIN], vnc: { host: "127.0.0.1", port: vncPort }, firstMessageTimeoutMs: 400, maxFailures: 4 },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  wsBase = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await app?.close();
  for (const s of vncSockets) s.destroy();
  vncSockets = [];
});

const start = async () => {
  const res = await app.inject({ method: "POST", url: `/api/suppliers/${supplier}/login-session`, cookies: { sid } });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { loginSession: { id: string }; token: string };
  return { id: body.loginSession.id, token: body.token };
};

type Outcome = { kind: "open"; ws: WebSocket } | { kind: "refused"; status: number };
/** Opens the screen the way a browser would: with the cookie and an Origin unless told otherwise. */
const open = (id: string, opts: { cookie?: boolean; origin?: string | null; query?: string } = {}): Promise<Outcome> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.cookie !== false) headers.cookie = `sid=${sid}`;
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    const ws = new WebSocket(`${wsBase}/api/login-sessions/${id}/screen${opts.query ?? ""}`, { headers });
    ws.once("open", () => resolve({ kind: "open", ws }));
    ws.once("unexpected-response", (_req, res) => resolve({ kind: "refused", status: res.statusCode ?? 0 }));
    ws.once("error", (e) => (e.message.includes("Unexpected server response") ? undefined : reject(e)));
  });
const opened = async (id: string, opts?: Parameters<typeof open>[1]) => {
  const r = await open(id, opts);
  if (r.kind !== "open") throw new Error(`expected an open connection, got ${r.status}`);
  return r.ws;
};
const next = (ws: WebSocket) => new Promise<{ data: Buffer; binary: boolean }>((resolve) => ws.once("message", (data, binary) => resolve({ data: data as Buffer, binary })));
const closedWith = (ws: WebSocket) => new Promise<number>((resolve) => (ws.readyState === WebSocket.CLOSED ? resolve(0) : ws.once("close", (code) => resolve(code))));
const audit = async (reason?: string) =>
  (await t.pool.query("select actor_user_id, entity_id, details from audit_events where action = 'login_session.screen_refused' order by id")).rows.filter(
    (r) => !reason || r.details.reason === reason,
  ) as { actor_user_id: string | null; entity_id: string; details: { reason: string } }[];

describe("refused before any connection is made", () => {
  it("refuses a request with no signed-in owner, with 401, reaching nothing", async () => {
    const { id } = await start();
    expect(await open(id, { cookie: false })).toEqual({ kind: "refused", status: 401 });
    expect(vncConnections).toBe(0);
    expect(await audit("no_session")).toHaveLength(1);
  });

  it("refuses a made-up or expired session cookie the same way", async () => {
    const { id } = await start();
    const ws = new WebSocket(`${wsBase}/api/login-sessions/${id}/screen`, { headers: { cookie: "sid=forged", origin: ORIGIN } });
    const status = await new Promise((resolve) => ws.once("unexpected-response", (_r, res) => resolve(res.statusCode)));
    expect(status).toBe(401);
    expect(vncConnections).toBe(0);
  });

  it.each([
    ["another website", "http://evil.example"],
    ["a look-alike of the real one", "http://localhost:3000.evil.example"],
    ["the right host on another port", "http://localhost:3001"],
    ["the right host on https", "https://localhost:3000"],
    ["the string null", "null"],
  ])("refuses a signed-in owner's cookie sent from %s, with 403", async (_n, origin) => {
    const { id } = await start();
    expect(await open(id, { origin })).toEqual({ kind: "refused", status: 403 });
    expect(vncConnections).toBe(0);
    expect(await audit("bad_origin")).toHaveLength(1);
  });

  it("refuses a request with no Origin at all", async () => {
    const { id } = await start();
    expect(await open(id, { origin: null })).toEqual({ kind: "refused", status: 403 });
    expect(vncConnections).toBe(0);
  });

  it("audits who was refused when the owner was signed in, and never records a token", async () => {
    const { id, token } = await start();
    await open(id, { origin: "http://evil.example", query: `?token=${token}` });
    const [event] = await audit("bad_origin");
    expect(event).toMatchObject({ actor_user_id: userId, entity_id: id });
    expect(JSON.stringify(await t.pool.query("select * from audit_events"))).not.toContain(token);
  });
});

describe("the one-time token, sent as the first message", () => {
  it("does not read a token from the address", async () => {
    const { id, token } = await start();
    const ws = await opened(id, { query: `?token=${token}` });
    expect(await closedWith(ws)).toBe(1008); // no first message arrived in time
    expect(vncConnections).toBe(0);
    expect(await audit("timeout")).toHaveLength(1);
    expect((await loginRepo().get(id))?.tokenUsedAt).toBeNull(); // and the token was not used up
  });

  it("closes a connection that sends nothing", async () => {
    const { id } = await start();
    expect(await closedWith(await opened(id))).toBe(1008);
    expect(vncConnections).toBe(0);
  });

  it.each([
    ["a wrong token", () => randomBytes(32).toString("hex")],
    ["something that is not a token", () => "hello"],
    ["an enormous message", () => "a".repeat(5000)],
  ])("refuses %s and reaches nothing", async (_n, make) => {
    const { id } = await start();
    const ws = await opened(id);
    ws.send(make());
    expect(await closedWith(ws)).toBe(1008);
    expect(vncConnections).toBe(0);
    expect((await audit()).length).toBe(1);
  });

  it("refuses a first message that is binary", async () => {
    const { id, token } = await start();
    const ws = await opened(id);
    ws.send(Buffer.from(token), { binary: true });
    expect(await closedWith(ws)).toBe(1008);
    expect(vncConnections).toBe(0);
    expect(await audit("bad_message")).toHaveLength(1);
  });

  it("refuses another login's token, and an expired one", async () => {
    const first = await start();
    await app.inject({ method: "POST", url: `/api/login-sessions/${first.id}/cancel`, cookies: { sid } });
    const second = await start();
    const wsA = await opened(second.id);
    wsA.send(first.token);
    expect(await closedWith(wsA)).toBe(1008);

    await t.pool.query("update login_sessions set token_expires_at = now() - interval '1 second' where id = $1", [second.id]);
    const wsB = await opened(second.id);
    wsB.send(second.token);
    expect(await closedWith(wsB)).toBe(1008);
    expect(await audit("token_expired")).toHaveLength(1);
    expect(vncConnections).toBe(0);
  });

  it("refuses a login that has ended", async () => {
    const { id, token } = await start();
    await app.inject({ method: "POST", url: `/api/login-sessions/${id}/cancel`, cookies: { sid } });
    const ws = await opened(id);
    ws.send(token);
    expect(await closedWith(ws)).toBe(1008);
    expect(await audit("token_not_ready")).toHaveLength(1);
  });

  it("works once: a second connection with the same token is refused", async () => {
    const { id, token } = await start();
    const a = await opened(id);
    a.send(token);
    expect(JSON.parse((await next(a)).data.toString())).toMatchObject({ type: "ready" });
    const b = await opened(id);
    b.send(token);
    expect(await closedWith(b)).toBe(1008);
    expect(await audit("token_used")).toHaveLength(1);
    expect(vncConnections).toBe(1);
    a.close();
  });

  it("lets exactly one of several simultaneous connections win", async () => {
    const { id, token } = await start();
    const sockets = await Promise.all(Array.from({ length: 6 }, () => opened(id)));
    sockets.forEach((ws) => ws.send(token));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(vncConnections).toBe(1);
    expect(sockets.filter((ws) => ws.readyState === WebSocket.OPEN)).toHaveLength(1);
    sockets.forEach((ws) => ws.close());
  });
});

describe("a good connection", () => {
  it("says ready with the VNC password, then passes bytes both ways", async () => {
    const { id, token } = await start();
    const ws = await opened(id);
    ws.send(token);
    const ready = await next(ws);
    expect(ready.binary).toBe(false);
    expect(JSON.parse(ready.data.toString())).toEqual({ type: "ready", vncPassword: VNC_PASSWORD });
    const banner = await next(ws);
    expect(banner.binary).toBe(true);
    expect(banner.data.toString()).toBe("RFB 003.008\n");
    ws.send(Buffer.from("hello vnc"), { binary: true });
    expect((await next(ws)).data.toString()).toBe("echo:hello vnc");
    expect(Buffer.concat(vncReceived).toString()).toBe("hello vnc");
    expect((await loginRepo().get(id))?.status).toBe("connected");
    ws.close();
  });

  it("leaves out the password when the browser service sent none", async () => {
    fake.behaviour.vncPassword = undefined;
    const { id, token } = await start();
    const ws = await opened(id);
    ws.send(token);
    expect(JSON.parse((await next(ws)).data.toString())).toEqual({ type: "ready" });
    ws.close();
  });

  it("closes the VNC connection when the owner's page closes, and the page when the VNC server closes", async () => {
    const a = await start();
    const wsA = await opened(a.id);
    wsA.send(a.token);
    await next(wsA);
    wsA.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(vncSockets[0]?.destroyed).toBe(true);

    await app.inject({ method: "POST", url: `/api/login-sessions/${a.id}/cancel`, cookies: { sid } });
    const b = await start();
    const wsB = await opened(b.id);
    wsB.send(b.token);
    await next(wsB);
    vncSockets.at(-1)?.destroy();
    await closedWith(wsB);
    expect(wsB.readyState).toBe(WebSocket.CLOSED);
  });

  it("closes the page's connection when the login is finished, cancelled or runs out of time", async () => {
    const a = await start();
    const wsA = await opened(a.id);
    wsA.send(a.token);
    await next(wsA);
    fake.behaviour.state = { cookies: [{ name: "s", value: "v", domain: "shop.acme.example", path: "/" }], origins: [] };
    await app.inject({ method: "POST", url: `/api/login-sessions/${a.id}/finish`, cookies: { sid } });
    await closedWith(wsA);
    expect(wsA.readyState).toBe(WebSocket.CLOSED);

    const b = await start();
    const wsB = await opened(b.id);
    wsB.send(b.token);
    await next(wsB);
    await app.inject({ method: "POST", url: `/api/login-sessions/${b.id}/cancel`, cookies: { sid } });
    await closedWith(wsB);
    expect(wsB.readyState).toBe(WebSocket.CLOSED);
  });

  it("writes an audit event when the screen is connected, and never records what it carries", async () => {
    const { id, token } = await start();
    const ws = await opened(id);
    ws.send(token);
    await next(ws);
    await next(ws);
    ws.send(Buffer.from(MARKER), { binary: true });
    await next(ws);
    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const events = (await t.pool.query("select action, actor_user_id, entity_id, details from audit_events where action = 'login_session.screen_connected'")).rows;
    expect(events).toEqual([expect.objectContaining({ actor_user_id: userId, entity_id: id })]);
    const everything = [...logLines, JSON.stringify((await t.pool.query("select * from audit_events")).rows), JSON.stringify((await t.pool.query("select * from login_sessions")).rows)].join("\n");
    for (const secret of [MARKER, token, VNC_PASSWORD]) expect(everything, secret).not.toContain(secret);
  });

  it("closes the page's connection, with no password sent, when the VNC server cannot be reached", async () => {
    const { id, token } = await start();
    const saved = vnc.listening;
    expect(saved).toBe(true);
    const unreachable = buildApp({
      db: t.appDb,
      logger,
      loginSessions: { suppliers: supplierRepo(), loginSessions: loginRepo(), supplierSessions: createSupplierSessionRepository(t.appDb), browser: createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN }), key, notifications: createNotificationRepository(t.appDb), queue: { enqueue: async () => {} } },
      loginScreen: { allowedOrigins: [ORIGIN], vnc: { host: "127.0.0.1", port: 1 }, firstMessageTimeoutMs: 400 },
    });
    await unreachable.listen({ port: 0, host: "127.0.0.1" });
    const ws = new WebSocket(`ws://127.0.0.1:${(unreachable.server.address() as AddressInfo).port}/api/login-sessions/${id}/screen`, { headers: { cookie: `sid=${sid}`, origin: ORIGIN } });
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(d.toString()));
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(token);
    expect(await closedWith(ws)).toBe(1011);
    expect(messages).toEqual([]);
    expect(await audit("vnc_unreachable")).toHaveLength(1);
    await unreachable.close();
  });
});

describe("repeated failures", () => {
  it("are slowed down: after four refusals the next try is refused at once, with 429", async () => {
    const { id } = await start();
    for (let i = 0; i < 4; i++) await open(id, { origin: "http://evil.example" });
    expect(await open(id)).toEqual({ kind: "refused", status: 429 });
    expect(vncConnections).toBe(0);
    expect(await audit("rate_limited")).toHaveLength(1);
  });
});
