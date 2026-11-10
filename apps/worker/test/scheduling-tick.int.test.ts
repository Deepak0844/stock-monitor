import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createCheckRunRepository, createMappingRepository, createRecipeRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { createLogger } from "@stock-monitor/shared";
import { sealSessionState } from "@stock-monitor/supplier-session";
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
