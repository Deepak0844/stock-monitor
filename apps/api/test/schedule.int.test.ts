import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createCheckRunRepository, createRecipeRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { sealSessionState } from "@stock-monitor/supplier-session";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid: string;
let acme = "";
const key = randomBytes(32);
const MIN = 60_000;
const NOW = new Date("2026-06-10T04:30:00Z"); // 10:00 in Kolkata
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const app = () =>
  buildApp({
    db: t.appDb,
    logger,
    schedule: {
      suppliers: createSupplierRepository(t.appDb),
      supplierSessions: createSupplierSessionRepository(t.appDb),
      recipes: createRecipeRepository(t.appDb),
      checkRuns: createCheckRunRepository(t.appDb),
      timezone: "Asia/Kolkata",
      now: () => NOW,
      random: () => 0,
    },
  });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: "GET" | "PUT", url: string, body?: unknown, cookie = true) {
  const res = await app().inject({ method, url, cookies: cookie ? { sid } : {}, ...(body !== undefined ? { payload: body as never } : {}) });
  return { status: res.statusCode, body: res.json() as Json };
}
const suppliers = () => createSupplierRepository(t.appDb);
const runs = () => createCheckRunRepository(t.appDb);
const day = { start: "07:00", end: "22:00" };

beforeAll(async () => {
  t = await startTestDb();
  const user = await t.pool.query("insert into users (email, password_hash) values ('owner@example.com', 'h') returning id");
  sid = randomBytes(32).toString("hex");
  await t.pool.query("insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [user.rows[0].id, createHash("sha256").update(sid).digest("hex")]);
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, audit_events cascade");
  const s = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  acme = s.supplier.id;
});
const makeReady = async () => {
  const state = { cookies: [], origins: [] };
  await createSupplierSessionRepository(t.appDb).save(acme, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(acme);
  await suppliers().setPermission(acme, { status: "granted", note: null });
  const r = await createRecipeRepository(t.appDb).create(acme, { pageChecks: [{ type: "text", text: "Tee" }], inStock: [], outOfStock: [] });
  await createRecipeRepository(t.appDb).activate(r.id);
};

describe("every schedule route needs a signed-in owner", () => {
  it.each([["PUT", `/api/suppliers/x/schedule`], ["GET", "/api/schedule"], ["GET", "/api/suppliers/x/runs"], ["GET", "/api/suppliers/x/runs/current"]])("%s %s returns 401", async (method, url) => {
    expect((await call(method as "GET", url, undefined, false)).status).toBe(401);
  });
});

describe("PUT /api/suppliers/:id/schedule", () => {
  it("saves the interval and window, sets the next check one interval ahead, and audits it", async () => {
    const r = await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: 1440, window: day });
    expect(r.status).toBe(200);
    expect(r.body.supplier).toMatchObject({ scheduleIntervalMinutes: 1440, scheduleWindowStart: "07:00", scheduleWindowEnd: "22:00", failureCount: 0 });
    expect(new Date(r.body.supplier.nextCheckAt).getTime()).toBe(NOW.getTime() + 1440 * MIN);
    const audit = await t.pool.query("select details from audit_events where action = 'supplier.schedule_set'");
    expect(audit.rows[0].details).toEqual({ intervalMinutes: 1440, window: day });
  });

  it("moves the next check into the window", async () => {
    const r = await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: 60, window: { start: "13:00", end: "14:00" } });
    // 10:00 + 1 hour = 11:00 local, outside 13:00-14:00, so 13:00 local = 07:30 UTC.
    expect(new Date(r.body.supplier.nextCheckAt).toISOString()).toBe("2026-06-10T07:30:00.000Z");
  });

  it("turns automatic checks off and clears the next check, keeping the window", async () => {
    await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: 360, window: day });
    const r = await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: null, window: day });
    expect(r.body.supplier).toMatchObject({ scheduleIntervalMinutes: null, nextCheckAt: null, scheduleWindowStart: "07:00" });
    expect(await suppliers().scheduled()).toEqual([]);
  });

  it("accepts all day", async () => {
    const r = await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: 720, window: null });
    expect(r.body.supplier).toMatchObject({ scheduleWindowStart: null, scheduleWindowEnd: null });
  });

  it("leaves a run that is going alone when the interval changes", async () => {
    const run = (await runs().start(acme, "manual", 3))!;
    await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: 60, window: null });
    expect(await runs().current(acme)).toMatchObject({ id: run.id, outcome: "running" });
  });

  it.each([
    ["an interval that is not on the list", { intervalMinutes: 45, window: null }],
    ["a text interval", { intervalMinutes: "60", window: null }],
    ["a missing window", { intervalMinutes: 60 }],
    ["a window that starts and ends together", { intervalMinutes: 60, window: { start: "07:00", end: "07:00" } }],
    ["a time that is not a time", { intervalMinutes: 60, window: { start: "7am", end: "22:00" } }],
    ["a time past midnight", { intervalMinutes: 60, window: { start: "07:00", end: "24:30" } }],
    ["an extra field", { intervalMinutes: 60, window: null, nextCheckAt: "2026-01-01T00:00:00Z" }],
  ])("refuses %s", async (_what, body) => {
    const r = await call("PUT", `/api/suppliers/${acme}/schedule`, body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_schedule");
    expect((await suppliers().get(acme))?.scheduleIntervalMinutes).toBeNull();
  });

  it("says plainly when the supplier does not exist", async () => {
    expect((await call("PUT", "/api/suppliers/00000000-0000-4000-8000-000000000000/schedule", { intervalMinutes: 60, window: null })).status).toBe(404);
  });
});

describe("GET /api/schedule", () => {
  it("is off for a supplier with no interval", async () => {
    const r = await call("GET", "/api/schedule");
    expect(r.body.schedule).toEqual([{ supplierId: acme, status: { state: "off" }, intervalMinutes: null, window: null, nextCheckAt: null, run: null, lastRun: null }]);
  });

  it("is waiting for a ready supplier, with the next check time", async () => {
    await makeReady();
    await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: 1440, window: day });
    const [row] = (await call("GET", "/api/schedule")).body.schedule;
    expect(row).toMatchObject({ status: { state: "waiting" }, intervalMinutes: 1440, window: day });
    expect(new Date(row.nextCheckAt).getTime()).toBe(NOW.getTime() + 1440 * MIN);
  });

  it.each([
    ["permission is not recorded", () => suppliers().setPermission(acme, { status: "unknown", note: null }), "no_permission", /recorded permission/],
    ["the supplier is paused", () => suppliers().pause(acme), "paused", /paused/],
    ["there is no login", () => createSupplierSessionRepository(t.appDb).remove(acme), "not_connected", /not connected/],
    ["no stock rules are on", () => t.pool.query("update stock_recipes set active = false"), "no_recipe", /Turn on stock rules/],
  ])("says why a supplier is not being checked when %s", async (_what, change, reason, message) => {
    await makeReady();
    await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: 1440, window: null });
    await change();
    const [row] = (await call("GET", "/api/schedule")).body.schedule;
    expect(row.status).toMatchObject({ state: "not_checked", reason });
    expect(row.status.message).toMatch(message);
  });

  it("shows the run that is going, then the last finished one", async () => {
    await makeReady();
    await call("PUT", `/api/suppliers/${acme}/schedule`, { intervalMinutes: 1440, window: null });
    const run = (await runs().start(acme, "scheduled", 40))!;
    await runs().progress(run.id, { linksDone: 12, inStock: 8, outOfStock: 1, cannotTell: 3 });
    let [row] = (await call("GET", "/api/schedule")).body.schedule;
    expect(row).toMatchObject({ status: { state: "running" }, run: { linksTotal: 40, linksDone: 12 }, lastRun: null });
    await runs().end(run.id, "finished", null);
    [row] = (await call("GET", "/api/schedule")).body.schedule;
    expect(row).toMatchObject({ status: { state: "waiting" }, run: null, lastRun: { outcome: "finished", linksDone: 12, cannotTell: 3 } });
  });
});

describe("run history", () => {
  it("lists a supplier's recent runs, newest first, with counts and no addresses", async () => {
    const a = (await runs().start(acme, "manual", 2))!;
    await runs().end(a.id, "stopped", "captcha");
    const b = (await runs().start(acme, "scheduled", 5))!;
    const list = (await call("GET", `/api/suppliers/${acme}/runs`)).body.runs;
    expect(list.map((r: Json) => r.id)).toEqual([b.id, a.id]);
    expect(list[1]).toMatchObject({ outcome: "stopped", stopReason: "captcha", trigger: "manual" });
    expect(JSON.stringify(list)).not.toContain("acme.example");
    expect((await call("GET", `/api/suppliers/${acme}/runs/current`)).body.run).toMatchObject({ id: b.id });
  });

  it("says plainly when the supplier is unknown, and has no current run when none is going", async () => {
    expect((await call("GET", "/api/suppliers/00000000-0000-4000-8000-000000000000/runs")).status).toBe(404);
    expect((await call("GET", `/api/suppliers/${acme}/runs/current`)).body).toEqual({ run: null });
  });
});
