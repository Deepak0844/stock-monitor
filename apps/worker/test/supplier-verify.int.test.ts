import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createNotificationRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { createBrowserClient } from "@stock-monitor/browser-client";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN, type FakeBrowserService } from "@stock-monitor/browser-client/testing";
import { createLogger } from "@stock-monitor/shared";
import { sealSessionState } from "@stock-monitor/supplier-session";
import { createSupplierVerifyHandler, verifySupplierSession, type SupplierVerifyDeps } from "../src/supplier-verify.js";

let t: TestDb;
let fake: FakeBrowserService;
const key = randomBytes(32);
const logLines: string[] = [];
const logger = createLogger({ level: "debug", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });
const sleeps: number[] = [];

const COOKIE = "COOKIE-SECRET-MARKER-3a7c";
const STORAGE = "LOCALSTORAGE-SECRET-MARKER-b81e";
const state = { cookies: [{ name: "session", value: COOKIE, domain: "shop.acme.example", path: "/" }], origins: [{ origin: "https://shop.acme.example", localStorage: [{ name: "auth", value: STORAGE }] }] };

const suppliers = () => createSupplierRepository(t.appDb);
const sessions = () => createSupplierSessionRepository(t.appDb);
const notes = () => createNotificationRepository(t.appDb);
const deps = (over: Partial<SupplierVerifyDeps> = {}): SupplierVerifyDeps => ({
  suppliers: suppliers(),
  supplierSessions: sessions(),
  notifications: notes(),
  audit: createAuditWriter(t.appDb),
  browser: createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 2000 }),
  key,
  logger,
  retryDelaysMs: [10_000, 60_000],
  sleep: async (ms) => void sleeps.push(ms),
  ...over,
});

let acme = "";
let globex = "";
beforeAll(async () => {
  t = await startTestDb();
  fake = await createFakeBrowserService();
}, 180_000);
afterAll(async () => {
  await fake?.close();
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, audit_events cascade");
  fake.requests.length = 0;
  logLines.length = 0;
  sleeps.length = 0;
  Object.assign(fake.behaviour, { verify: "ok", verifyResult: "ok", delayMs: 0 });
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/account", loginUrl: "https://shop.acme.example/login", checkIntervalMinutes: 60 });
  const g = await suppliers().create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!a.ok || !g.ok) throw new Error("setup");
  acme = a.supplier.id;
  globex = g.supplier.id;
  await sessions().save(acme, sealSessionState(state, key, "v1"), state);
  await sessions().save(globex, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(acme);
  await suppliers().markConnected(globex);
});

const supplier = async (id: string) => (await suppliers().get(id))!;
const audit = async () => (await t.pool.query("select action, entity_id, details from audit_events where action = 'supplier.session_checked'")).rows as { entity_id: string; details: { result: string; httpStatus: number | null } }[];
const verifies = () => fake.requests.filter((r) => r.path === "/verify");

describe("nothing to check", () => {
  it("skips a supplier that does not exist, and one with no saved session, without asking the browser", async () => {
    expect(await verifySupplierSession(deps(), "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "skipped", reason: "no_supplier" });
    await sessions().remove(acme);
    expect(await verifySupplierSession(deps(), acme)).toEqual({ kind: "skipped", reason: "no_session" });
    expect(verifies()).toHaveLength(0);
  });
});

describe("a session that works", () => {
  it("opens the saved session in the browser, and marks the supplier connected and checked", async () => {
    await suppliers().markNeedsAttention(acme, "needs_reconnect");
    await notes().raise({ kind: "supplier_needs_reconnect", supplierId: acme, message: "Acme needs you to log in again.", reason: "login_required" });
    expect(await verifySupplierSession(deps(), acme)).toEqual({ kind: "ok" });

    expect(await supplier(acme)).toMatchObject({ sessionStatus: "connected", enabled: true, pausedReason: null, lastSessionCheckAt: expect.any(Date) });
    expect((await sessions().facts(acme))?.lastVerifiedAt).toBeInstanceOf(Date);
    expect(await notes().listOpen()).toEqual([]);
    // The browser was given the page, the owner's login address, and the real saved session.
    expect(verifies()[0]?.body).toEqual({ url: "https://shop.acme.example/account", loginUrl: "https://shop.acme.example/login", state });
  });

  it("leaves an owner's pause in place", async () => {
    await suppliers().pause(acme);
    await verifySupplierSession(deps(), acme);
    expect(await supplier(acme)).toMatchObject({ enabled: false, pausedReason: "owner", sessionStatus: "connected" });
  });

  it("writes an audit event saying only what was found", async () => {
    await verifySupplierSession(deps(), acme);
    expect(await audit()).toEqual([expect.objectContaining({ entity_id: acme, details: { result: "ok", httpStatus: 200 } })]);
  });
});

describe("a session that needs attention", () => {
  it.each([
    ["login_required", "needs_reconnect", "Acme needs you to log in again."],
    ["captcha", "blocked", "Acme is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it."],
    ["blocked", "blocked", "Acme is refusing our automated checks, even though your login may have worked. It stays paused. Ask the supplier for a price list or feed, or reconnect to try again."],
    ["unknown", "needs_reconnect", "We could not tell whether Acme is still logged in. Reconnect the supplier to be sure."],
  ])("%s sets the status %s, pauses only that supplier, and raises one plain notification", async (result, status, message) => {
    fake.behaviour.verifyResult = result;
    expect(await verifySupplierSession(deps(), acme)).toEqual({ kind: "needs_attention", result });
    expect(await supplier(acme)).toMatchObject({ sessionStatus: status, enabled: false, pausedReason: "session" });
    expect(await supplier(globex)).toMatchObject({ sessionStatus: "connected", enabled: true, pausedReason: null });
    expect(await notes().listOpen()).toEqual([expect.objectContaining({ supplierId: acme, supplierName: "Acme", message, reason: result })]);
    expect(await audit()).toEqual([expect.objectContaining({ details: { result, httpStatus: 200 } })]);
  });

  it("raises one notification however many checks find the problem", async () => {
    fake.behaviour.verifyResult = "login_required";
    for (let i = 0; i < 4; i++) await verifySupplierSession(deps(), acme);
    expect(await notes().listOpen()).toHaveLength(1);
  });

  it("updates the notification's wording when the problem changes", async () => {
    fake.behaviour.verifyResult = "login_required";
    await verifySupplierSession(deps(), acme);
    fake.behaviour.verifyResult = "captcha";
    await verifySupplierSession(deps(), acme);
    const open = await notes().listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ reason: "captcha" });
    expect((await supplier(acme)).sessionStatus).toBe("blocked");
  });

  it("keeps an owner's pause as the owner's, and still raises the notification", async () => {
    await suppliers().pause(acme);
    fake.behaviour.verifyResult = "login_required";
    await verifySupplierSession(deps(), acme);
    expect(await supplier(acme)).toMatchObject({ enabled: false, pausedReason: "owner", sessionStatus: "needs_reconnect" });
    expect(await notes().listOpen()).toHaveLength(1);
  });

  it("treats a saved session that cannot be read as needing attention, without asking the browser", async () => {
    const r = await verifySupplierSession(deps({ key: randomBytes(32) }), acme);
    expect(r).toEqual({ kind: "needs_attention", result: "unknown" });
    expect(verifies()).toHaveLength(0);
    expect(await supplier(acme)).toMatchObject({ sessionStatus: "needs_reconnect", pausedReason: "session" });
  });

  it("is lifted by a later good check: the pause goes and the notification is resolved", async () => {
    fake.behaviour.verifyResult = "login_required";
    await verifySupplierSession(deps(), acme);
    fake.behaviour.verifyResult = "ok";
    await verifySupplierSession(deps(), acme);
    expect(await supplier(acme)).toMatchObject({ sessionStatus: "connected", enabled: true, pausedReason: null });
    expect(await notes().listOpen()).toEqual([]);
  });
});

describe("a supplier that cannot be reached", () => {
  it("is tried again after a wait, twice, before anything is decided", async () => {
    fake.behaviour.verifyResult = "unreachable";
    expect(await verifySupplierSession(deps(), acme)).toEqual({ kind: "unreachable" });
    expect(verifies()).toHaveLength(3);
    expect(sleeps).toEqual([10_000, 60_000]);
  });

  it("does not by itself mark the session broken, pause the supplier or raise a notification", async () => {
    fake.behaviour.verifyResult = "unreachable";
    await verifySupplierSession(deps(), acme);
    expect(await supplier(acme)).toMatchObject({ sessionStatus: "connected", enabled: true, pausedReason: null, lastSessionCheckAt: expect.any(Date) });
    expect(await notes().listOpen()).toEqual([]);
    expect(await audit()).toEqual([expect.objectContaining({ details: { result: "unreachable", httpStatus: null } })]);
  });

  it("carries on as normal when a retry gets through", async () => {
    fake.behaviour.verifyResult = "unreachable";
    const r = await verifySupplierSession(deps({ sleep: async () => void (fake.behaviour.verifyResult = "ok") }), acme);
    expect(r).toEqual({ kind: "ok" });
    expect(verifies()).toHaveLength(2);
  });

  it("does not retry a clear answer", async () => {
    fake.behaviour.verifyResult = "login_required";
    await verifySupplierSession(deps(), acme);
    expect(verifies()).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe("a browser service that is down or broken", () => {
  it("is our problem, not the supplier's: nothing is paused and no notification is raised", async () => {
    const down = deps({ browser: createBrowserClient({ baseUrl: "http://127.0.0.1:1", token: FAKE_CONTROL_TOKEN, timeoutMs: 500 }) });
    expect(await verifySupplierSession(down, acme)).toEqual({ kind: "service_unavailable" });
    fake.behaviour.verify = "fail";
    expect(await verifySupplierSession(deps(), acme)).toEqual({ kind: "service_unavailable" });
    expect(await supplier(acme)).toMatchObject({ sessionStatus: "connected", enabled: true, pausedReason: null });
    expect(await notes().listOpen()).toEqual([]);
  });
});

describe("the job", () => {
  it("handles a job that carries only a supplier id, and returns nothing the queue could mistake for stock", async () => {
    fake.behaviour.verifyResult = "login_required";
    const handle = createSupplierVerifyHandler(deps());
    expect(await handle({ supplierId: acme })).toBeUndefined();
    expect((await supplier(acme)).sessionStatus).toBe("needs_reconnect");
  });

  it("never puts the session, a cookie or a token in a log line, an audit event or a notification", async () => {
    for (const result of ["login_required", "captcha", "unreachable", "ok"]) {
      fake.behaviour.verifyResult = result;
      await createSupplierVerifyHandler(deps())({ supplierId: acme });
    }
    const everything = [
      ...logLines,
      JSON.stringify((await t.pool.query("select * from audit_events")).rows),
      JSON.stringify((await t.pool.query("select * from notifications")).rows),
      JSON.stringify(await sessions().facts(acme)),
    ].join("\n");
    for (const secret of [COOKIE, STORAGE]) expect(everything, secret).not.toContain(secret);
  });
});
