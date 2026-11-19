import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createNotificationRepository, createProposalRepository, createCheckRunRepository, createMappingRepository, createRecipeRepository, createSupplierCredentialsRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { createLogger } from "@stock-monitor/shared";
import { sealCredentials, sealSessionState } from "@stock-monitor/supplier-session";
import { reapStaleRuns, runTick, type TickDeps } from "../src/scheduling-tick.js";

let t: TestDb;
const key = randomBytes(32);
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const MIN = 60_000;
// 2026-06-10 10:00 in Kolkata (UTC+5:30), inside a 07:00 to 22:00 window.
const T0 = new Date(Date.UTC(2026, 5, 10, 10, 0) - 5.5 * 60 * MIN);
let now = T0;
let enqueued: { name: string; payload: unknown; options?: { expireInSeconds?: number; retryLimit?: number } }[] = [];
let enqueueFails = false;

const suppliers = () => createSupplierRepository(t.appDb);
const runs = () => createCheckRunRepository(t.appDb);
const deps = (over: Partial<TickDeps> = {}): TickDeps => ({
  suppliers: suppliers(), supplierSessions: createSupplierSessionRepository(t.appDb), recipes: createRecipeRepository(t.appDb), mappings: createMappingRepository(t.appDb),
  checkRuns: runs(), audit: createAuditWriter(t.appDb), logger, timezone: "Asia/Kolkata", now: () => now,
  queue: { enqueue: async (name: string, payload: unknown, options?: never) => { if (enqueueFails) throw new Error("queue down"); enqueued.push({ name, payload, options }); } } as never,
  ...over,
});

const state = { cookies: [], origins: [] };
let variant = 0;
/** A supplier that is fully ready to be checked, due `dueMinutesAgo` minutes ago, with one link. */
async function ready(name: string, dueMinutesAgo = 5) {
  const r = await suppliers().create({ name, websiteUrl: `https://${name.toLowerCase()}.example/`, loginUrl: null, checkIntervalMinutes: 60 });
  if (!r.ok) throw new Error("setup");
  const id = r.supplier.id;
  await createSupplierSessionRepository(t.appDb).save(id, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(id);
  await suppliers().setPermission(id, { status: "granted", note: null });
  const recipe = await createRecipeRepository(t.appDb).create(id, { pageChecks: [{ type: "text", text: "Tee" }], inStock: [], outOfStock: [] });
  await createRecipeRepository(t.appDb).activate(recipe.id);
  const v = `v${++variant}`;
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ($1, 'p1', 'Tee', $1, '[]', $1, $1, true, 'DENY')`,
    [v],
  );
  await createMappingRepository(t.appDb).create({ variantId: v, supplierId: id, url: `https://${name.toLowerCase()}.example/p`, note: null });
  await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" }, nextCheckAt: new Date(now.getTime() - dueMinutesAgo * MIN) });
  return id;
}
const nextCheck = async (id: string) => (await suppliers().get(id))!.nextCheckAt;

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, audit_events cascade");
  now = T0;
  enqueued = [];
  enqueueFails = false;
});

describe("the tick and suggestions", () => {
  it("expires open suggestions that are past their time, and only those", async () => {
    const id = await ready("Acme");
    const link = (await createMappingRepository(t.appDb).forSupplier(id))[0]!;
    const proposals = createProposalRepository(t.appDb);
    const make = (expiresAt: Date) => proposals.evaluateFor({ variantId: link.variantId, mappingId: link.id, supplierId: id, observationId: null, shopifyQuantitySeen: 4, wanted: { kind: "set_zero_out_of_stock", proposedQuantity: 0 }, expiresAt });
    const due = (await make(new Date(now.getTime() - MIN))).proposal!;
    await runTick(deps({ proposals }));
    expect(await proposals.get(due.id)).toMatchObject({ state: "expired" });
    const later = (await make(new Date(now.getTime() + 60 * MIN))).proposal!;
    await runTick(deps({ proposals }));
    expect(await proposals.get(later.id)).toMatchObject({ state: "open" });
  });
});

describe("the tick and approved suggestions nobody finished", () => {
  it("queues the apply job again for an approved suggestion older than 15 minutes, and not for a recent one", async () => {
    const id = await ready("Acme");
    const link = (await createMappingRepository(t.appDb).forSupplier(id))[0]!;
    const proposals = createProposalRepository(t.appDb);
    const made = (await proposals.evaluateFor({ variantId: link.variantId, mappingId: link.id, supplierId: id, observationId: null, shopifyQuantitySeen: 4, wanted: { kind: "set_zero_out_of_stock", proposedQuantity: 0 }, expiresAt: new Date(now.getTime() + 60 * MIN) })).proposal!;
    await proposals.markApproved(made.id, 0, "owner", new Date(now.getTime() - 5 * MIN));
    await runTick(deps({ proposals }));
    expect(enqueued.filter((e) => e.name === "proposals.apply")).toEqual([]);
    now = new Date(now.getTime() + 11 * MIN);
    await runTick(deps({ proposals }));
    expect(enqueued.filter((e) => e.name === "proposals.apply")).toEqual([{ name: "proposals.apply", payload: { proposalId: made.id }, options: { retryLimit: 0 } }]);
  });
});

describe("the tick", () => {
  it("starts a due supplier once: a scheduled run row, then one job with only the ids and time to finish", async () => {
    const id = await ready("Acme");
    expect(await runTick(deps())).toMatchObject({ started: [id], skipped: [] });
    const run = (await runs().current(id))!;
    expect(run).toMatchObject({ trigger: "scheduled", linksTotal: 1, outcome: "running" });
    expect(enqueued).toEqual([{ name: "extraction.checks", payload: { supplierId: id, runId: run.id }, options: { expireInSeconds: 900, retryLimit: 0 } }]);
    expect((await t.pool.query("select action from audit_events where action = 'check_run.started'")).rowCount).toBe(1);
    expect((await runTick(deps())).started).toEqual([]);
    expect(enqueued).toHaveLength(1);
  });

  it("starts a supplier whose next check was never set (turned on in an old backup)", async () => {
    const id = await ready("Acme");
    await t.pool.query("update suppliers set next_check_at = null where id = $1", [id]);
    expect((await runTick(deps())).started).toEqual([id]);
  });

  it("leaves a supplier alone that is not due yet, or is outside its quiet hours", async () => {
    const later = await ready("Later", -30);
    const night = await ready("Night");
    await suppliers().setSchedule(night, { intervalMinutes: 1440, window: { start: "11:00", end: "12:00" }, nextCheckAt: new Date(now.getTime() - 5 * MIN) });
    expect((await runTick(deps())).started).toEqual([]);
    expect((await runs().recent(later, 5)).length + (await runs().recent(night, 5)).length).toBe(0);
  });

  it.each([
    ["is paused", (id: string) => suppliers().pause(id), "paused"],
    ["is not recorded as allowed", (id: string) => suppliers().setPermission(id, { status: "unknown", note: null }), "no_permission"],
    ["has no saved session", (id: string) => t.pool.query("delete from supplier_sessions where supplier_id = $1", [id]), "not_connected"],
    ["has no active rules", (id: string) => t.pool.query("update stock_recipes set active = false where supplier_id = $1", [id]), "no_recipe"],
  ] as const)("never visits a supplier that %s, says why, and leaves its next check where it was", async (_what, change, reason) => {
    const id = await ready("Acme");
    const before = await nextCheck(id);
    await change(id);
    expect(await runTick(deps())).toEqual({ started: [], skipped: [{ supplierId: id, reason }] });
    expect(await nextCheck(id)).toEqual(before);
    expect(enqueued).toEqual([]);
    expect(await runs().recent(id, 5)).toEqual([]);
  });

  it("starts at most 2 suppliers at once, the longest overdue first, counting runs already going", async () => {
    const a = await ready("Aaa", 10);
    const b = await ready("Bbb", 60);
    const c = await ready("Ccc", 30);
    expect((await runTick(deps())).started).toEqual([b, c]);
    expect((await runTick(deps())).started).toEqual([]);
    // b finishes, and a finished run moves its next check a day ahead.
    await runs().end((await runs().current(b))!.id, "finished", null);
    await suppliers().recordRunEnd(b, { nextCheckAt: new Date(now.getTime() + 1440 * MIN), failureCount: 0 });
    expect((await runTick(deps())).started).toEqual([a]);
  });

  it("two ticks at the same moment start one run for a supplier", async () => {
    const id = await ready("Acme");
    const both = await Promise.all([runTick(deps()), runTick(deps())]);
    expect(both.flatMap((r) => r.started)).toEqual([id]);
    expect(enqueued).toHaveLength(1);
    expect((await runs().recent(id, 5)).length).toBe(1);
  });

  it("does not start a supplier that a manual run is already checking", async () => {
    const id = await ready("Acme");
    await runs().start(id, "manual", 1);
    expect((await runTick(deps())).started).toEqual([]);
  });

  it("after downtime a supplier that is days overdue runs once", async () => {
    const id = await ready("Acme", 3 * 24 * 60);
    expect((await runTick(deps())).started).toEqual([id]);
    expect(enqueued).toHaveLength(1);
  });

  it("ends the run as failed when the job cannot be queued", async () => {
    const id = await ready("Acme");
    enqueueFails = true;
    expect((await runTick(deps())).started).toEqual([]);
    expect((await runs().recent(id, 1))[0]).toMatchObject({ outcome: "failed", stopReason: "not_queued" });
    enqueueFails = false;
    expect((await runTick(deps())).started).toEqual([id]);
  });

  it("stops a run that has been going longer than the queue allows, and deletes runs older than 30 days", async () => {
    const stuck = await ready("Stuck");
    await suppliers().setSchedule(stuck, { intervalMinutes: 1440, window: null, nextCheckAt: new Date(now.getTime() + 999 * MIN) });
    const row = (await runs().start(stuck, "scheduled", 1))!;
    await t.pool.query("update check_runs set started_at = now() - interval '6 hours 6 minutes' where id = $1", [row.id]);
    const old = (await runs().start((await ready("Old", -999)), "manual", 1))!;
    await runs().end(old.id, "finished", null);
    await t.pool.query("update check_runs set started_at = now() - interval '40 days' where id = $1", [old.id]);
    await runTick(deps());
    expect((await runs().recent(stuck, 1))[0]).toMatchObject({ outcome: "stopped", stopReason: "expired" });
    expect((await t.pool.query("select id from check_runs where id = $1", [old.id])).rowCount).toBe(0);
  });
});

describe("a restart", () => {
  it("ends every running run as stopped, and the supplier is picked up again only once its next check is due", async () => {
    const id = await ready("Acme", -60);
    await runs().start(id, "scheduled", 1);
    expect(await reapStaleRuns(deps())).toBe(1);
    expect((await runs().recent(id, 1))[0]).toMatchObject({ outcome: "stopped", stopReason: "restarted" });
    expect((await runTick(deps())).started).toEqual([]);
    now = new Date(now.getTime() + 61 * MIN);
    expect((await runTick(deps())).started).toEqual([id]);
  });
});

describe("the early login check before a run", () => {
  const early = () => enqueued.filter((e) => e.name === "supplier.session.verify");

  it("queues one check of the login when the run is within two hours, and not again on the next tick", async () => {
    const id = await ready("Acme", -90);
    await runTick(deps());
    expect(early()).toEqual([{ name: "supplier.session.verify", payload: { supplierId: id, early: true }, options: { retryLimit: 0 } }]);
    now = new Date(now.getTime() + MIN);
    await runTick(deps());
    expect(early()).toHaveLength(1);
  });

  it("does not check before the lead time", async () => {
    await ready("Acme", -150);
    await runTick(deps());
    expect(early()).toEqual([]);
  });

  it("does not check in quiet hours", async () => {
    const id = await ready("Acme", -90);
    await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "11:00", end: "22:00" }, nextCheckAt: new Date(now.getTime() + 90 * MIN) });
    await runTick(deps());
    expect(early()).toEqual([]);
  });

  it("does not check when a check in the lead time already proved the login", async () => {
    const id = await ready("Acme", -90);
    await createSupplierSessionRepository(t.appDb).markVerified(id);
    await runTick(deps());
    expect(early()).toEqual([]);
  });

  it("skips a supplier with automatic login on, since its run logs in by itself, and checks it again once that login is paused", async () => {
    const id = await ready("Acme", -90);
    await createSupplierCredentialsRepository(t.appDb).save(id, sealCredentials({ username: "u", password: "p" }, key, "v1"));
    const on = await suppliers().setAutoLogin(id, { autoLogin: true });
    if (!on.ok) throw new Error("setup");
    await runTick(deps());
    expect(early()).toEqual([]);
    await t.pool.query("update suppliers set auto_login_paused_reason = 'too_many_failures' where id = $1", [id]);
    await runTick(deps());
    expect(early()).toEqual([{ name: "supplier.session.verify", payload: { supplierId: id, early: true }, options: { retryLimit: 0 } }]);
  });

  it("does not check a supplier the stock gate refuses", async () => {
    const id = await ready("Acme", -90);
    await suppliers().markNeedsAttention(id, "needs_reconnect");
    await runTick(deps());
    expect(early()).toEqual([]);
  });
});

describe("keep login alive", () => {
  const visits = () => enqueued.filter((e) => e.name === "supplier.session.verify");
  /** Ready, its run 10 hours away (no run, no early check), keep-alive every 30 minutes. */
  async function keeping(name: string) {
    const id = await ready(name, -600);
    await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" }, nextCheckAt: new Date(now.getTime() + 600 * MIN), keepAliveMinutes: 30 });
    return id;
  }

  it("queues one visit, writes the next visit time first, and does not queue again on the next tick", async () => {
    const id = await keeping("Acme");
    await runTick(deps());
    expect(visits()).toEqual([{ name: "supplier.session.verify", payload: { supplierId: id, keepAlive: true }, options: { retryLimit: 0 } }]);
    const next = (await suppliers().get(id))!.keepAliveNextAt!;
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime() + 27 * MIN);
    expect(next.getTime()).toBeLessThanOrEqual(now.getTime() + 33 * MIN);
    now = new Date(now.getTime() + MIN);
    await runTick(deps());
    expect(visits()).toHaveLength(1);
  });

  it("keeps the next visit time even when the visit cannot be queued", async () => {
    const id = await keeping("Acme");
    enqueueFails = true;
    await runTick(deps());
    expect((await suppliers().get(id))!.keepAliveNextAt).not.toBeNull();
  });

  it("does not visit a supplier with keep-alive off", async () => {
    await ready("Acme", -600);
    await runTick(deps());
    expect(visits()).toEqual([]);
  });

  it("does not visit a paused supplier, one waiting for a new login, or one outside its hours", async () => {
    const paused = await keeping("Paused");
    await suppliers().pause(paused);
    const waiting = await keeping("Waiting");
    await suppliers().markNeedsAttention(waiting, "needs_reconnect");
    const night = await keeping("Night");
    await suppliers().setSchedule(night, { intervalMinutes: 1440, window: { start: "11:00", end: "22:00" }, nextCheckAt: new Date(now.getTime() + 600 * MIN) });
    await runTick(deps());
    expect(visits()).toEqual([]);
  });

  it("does not visit a supplier while a run is checking it", async () => {
    const id = await keeping("Acme");
    await runs().start(id, "manual", 1);
    await runTick(deps());
    expect(visits()).toEqual([]);
  });

  it("does not visit a supplier whose early login check was queued on this tick", async () => {
    const id = await keeping("Acme");
    await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" }, nextCheckAt: new Date(now.getTime() + 90 * MIN) });
    await runTick(deps());
    expect(visits()).toEqual([{ name: "supplier.session.verify", payload: { supplierId: id, early: true }, options: { retryLimit: 0 } }]);
  });

  it("does not visit a supplier whose run is due within 5 minutes: the visit would still hold its browser profile", async () => {
    const id = await keeping("Acme");
    await createSupplierCredentialsRepository(t.appDb).save(id, sealCredentials({ username: "u", password: "p" }, key, "v1"));
    if (!(await suppliers().setAutoLogin(id, { autoLogin: true })).ok) throw new Error("setup");
    await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" }, nextCheckAt: new Date(now.getTime() + 3 * MIN) });
    await runTick(deps());
    expect(visits()).toEqual([]);
    await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" }, nextCheckAt: new Date(now.getTime() + 10 * MIN) });
    await runTick(deps());
    expect(visits()).toHaveLength(1);
  });

  it("does not visit a supplier whose run starts on this tick", async () => {
    const id = await keeping("Acme");
    await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" }, nextCheckAt: new Date(now.getTime() - MIN) });
    await runTick(deps());
    expect(enqueued.map((e) => e.name)).toEqual(["extraction.checks"]);
  });
});

describe("login alert emails", () => {
  let mails: { subject: string; text: string }[] = [];
  let sendFails = false;
  const send = async (m: { subject: string; text: string }) => {
    if (sendFails) throw Object.assign(new Error("Invalid login: 535"), { code: "EAUTH" });
    mails.push(m);
  };
  const notes = () => createNotificationRepository(t.appDb);
  const alerts = () => ({ notifications: notes(), send, appOrigin: "https://stock.example.com" });
  beforeEach(() => {
    mails = [];
    sendFails = false;
  });
  const needsLogin = async (name: string) => {
    const r = await suppliers().create({ name, websiteUrl: `https://${name.toLowerCase()}.example/`, loginUrl: null, checkIntervalMinutes: 60 });
    if (!r.ok) throw new Error("setup");
    await notes().raise({ kind: "supplier_needs_reconnect", supplierId: r.supplier.id, message: `${name} needs you to log in again.`, reason: "login_required" });
    return r.supplier.id;
  };

  it("emails a login notice once over two ticks, with the supplier's name and link", async () => {
    const id = await needsLogin("Acme");
    await runTick(deps({ alerts: alerts() }));
    await runTick(deps({ alerts: alerts() }));
    expect(mails).toEqual([{ subject: "Acme needs you to log in", text: `Acme needs you to log in again.\n\nLog in here: https://stock.example.com/suppliers/${id}/connect\n\nSent by Stock Monitor.` }]);
  });

  it("never emails a changed-pages notice", async () => {
    const id = await ready("Acme", -600);
    await notes().raise({ kind: "recipe_needs_review", supplierId: id, message: "Acme's pages changed.", reason: "page_changed" });
    await runTick(deps({ alerts: alerts() }));
    expect(mails).toEqual([]);
  });

  it("tries again on the next tick when Gmail refuses, and the tick still finishes", async () => {
    await needsLogin("Acme");
    sendFails = true;
    await expect(runTick(deps({ alerts: alerts() }))).resolves.toBeDefined();
    expect(mails).toEqual([]);
    sendFails = false;
    await runTick(deps({ alerts: alerts() }));
    expect(mails).toHaveLength(1);
  });

  it("does not email a notice that closed before the tick", async () => {
    const id = await needsLogin("Acme");
    await notes().resolve("supplier_needs_reconnect", id);
    await runTick(deps({ alerts: alerts() }));
    expect(mails).toEqual([]);
  });

  it("sends at most 10 a tick", async () => {
    for (let i = 0; i < 12; i++) await needsLogin(`S${i}`);
    await runTick(deps({ alerts: alerts() }));
    expect(mails).toHaveLength(10);
    await runTick(deps({ alerts: alerts() }));
    expect(mails).toHaveLength(12);
  });

  it("still finishes the tick when the notices cannot be read", async () => {
    const id = await ready("Acme", 5);
    const broken = { ...notes(), unemailedLogin: async () => { throw new Error("db blip"); } };
    const result = await runTick(deps({ alerts: { notifications: broken, send, appOrigin: undefined } }));
    expect(result.started).toEqual([id]);
  });

  it("sends nothing when alerts are off", async () => {
    await needsLogin("Acme");
    await runTick(deps());
    expect(mails).toEqual([]);
  });
});

describe("a supplier that needs no login", () => {
  const noLogin = async (id: string) => {
    await createSupplierSessionRepository(t.appDb).remove(id);
    await suppliers().markNotConnected(id);
    await suppliers().setNeedsLogin(id, false);
  };
  const verifies = () => enqueued.filter((e) => e.name === "supplier.session.verify");

  it("starts its due run with no saved login", async () => {
    const id = await ready("Acme");
    await noLogin(id);
    expect((await runTick(deps())).started).toEqual([id]);
  });

  it("never gets an early login check before a run", async () => {
    const id = await ready("Acme", -90);
    await noLogin(id);
    await runTick(deps());
    expect(verifies()).toEqual([]);
  });
});
