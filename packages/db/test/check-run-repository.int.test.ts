import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createCheckRunRepository } from "../src/check-run-repository.js";
import { createSupplierRepository } from "../src/supplier-repository.js";

let t: TestDb;
const runs = () => createCheckRunRepository(t.appDb);
const suppliers = () => createSupplierRepository(t.appDb);
let acme = "";
let globex = "";

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers cascade");
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  const g = await suppliers().create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!a.ok || !g.ok) throw new Error("setup");
  acme = a.supplier.id;
  globex = g.supplier.id;
});

describe("check runs", () => {
  it("allows one running run per supplier, and another after it ends", async () => {
    const first = await runs().start(acme, "scheduled", 4);
    expect(first).toMatchObject({ outcome: "running", linksTotal: 4, linksDone: 0, trigger: "scheduled" });
    expect(await runs().start(acme, "manual", 4)).toBeNull();
    expect(await runs().start(globex, "manual", 1)).not.toBeNull();
    await runs().end(first!.id, "finished", null);
    expect(await runs().start(acme, "manual", 4)).not.toBeNull();
  });

  it("two starts at the same moment give one run", async () => {
    const both = await Promise.all([runs().start(acme, "scheduled", 2), runs().start(acme, "manual", 2)]);
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it("records progress and the end", async () => {
    const r = (await runs().start(acme, "manual", 3))!;
    await runs().progress(r.id, { linksDone: 2, inStock: 1, outOfStock: 0, cannotTell: 1 });
    expect(await runs().current(acme)).toMatchObject({ linksDone: 2, inStock: 1, cannotTell: 1, endedAt: null });
    await runs().end(r.id, "stopped", "captcha");
    expect(await runs().current(acme)).toBeNull();
    expect((await runs().recent(acme, 10))[0]).toMatchObject({ outcome: "stopped", stopReason: "captcha" });
    expect((await runs().recent(acme, 10))[0]?.endedAt).toBeInstanceOf(Date);
  });

  it("stops every running run with a reason", async () => {
    await runs().start(acme, "scheduled", 1);
    await runs().start(globex, "scheduled", 1);
    expect(await runs().stopAllRunning("restarted")).toBe(2);
    expect(await runs().running()).toEqual([]);
    expect((await runs().recent(acme, 1))[0]).toMatchObject({ outcome: "stopped", stopReason: "restarted" });
  });

  it("deletes only runs that ended more than 30 days ago", async () => {
    const old = (await runs().start(acme, "manual", 1))!;
    await runs().end(old.id, "finished", null);
    await t.pool.query("update check_runs set ended_at = now() - interval '31 days', started_at = now() - interval '31 days' where id = $1", [old.id]);
    const fresh = (await runs().start(acme, "manual", 1))!;
    await runs().end(fresh.id, "finished", null);
    expect(await runs().purge(30)).toBe(1);
    expect((await runs().recent(acme, 10)).map((r) => r.id)).toEqual([fresh.id]);
  });

  it("is deleted with its supplier", async () => {
    await runs().start(acme, "manual", 1);
    await suppliers().remove(acme);
    expect((await t.pool.query("select count(*)::int as n from check_runs")).rows[0].n).toBe(0);
  });
});

describe("supplier schedule columns", () => {
  it("starts with automatic checks off", async () => {
    const s = (await suppliers().get(acme))!;
    expect(s).toMatchObject({ scheduleIntervalMinutes: null, scheduleWindowStart: null, scheduleWindowEnd: null, nextCheckAt: null, failureCount: 0 });
  });

  it("saves a schedule and lists scheduled suppliers only", async () => {
    const next = new Date("2026-06-11T01:30:00Z");
    const s = await suppliers().setSchedule(acme, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" }, nextCheckAt: next });
    expect(s).toMatchObject({ scheduleIntervalMinutes: 1440, scheduleWindowStart: "07:00", scheduleWindowEnd: "22:00", nextCheckAt: next, failureCount: 0 });
    expect((await suppliers().scheduled()).map((x) => x.id)).toEqual([acme]);
    await suppliers().setSchedule(acme, { intervalMinutes: null, window: null, nextCheckAt: null });
    expect(await suppliers().scheduled()).toEqual([]);
  });

  it("refuses an interval that is not on the list and a half-set window", async () => {
    await expect(t.pool.query("update suppliers set schedule_interval_minutes = 45 where id = $1", [acme])).rejects.toThrow();
    await expect(t.pool.query("update suppliers set schedule_window_start = '07:00' where id = $1", [acme])).rejects.toThrow();
  });

  it("stores the next check and failure count at the end of a run", async () => {
    const next = new Date("2026-06-12T00:00:00Z");
    await suppliers().recordRunEnd(acme, { nextCheckAt: next, failureCount: 2 });
    expect(await suppliers().get(acme)).toMatchObject({ nextCheckAt: next, failureCount: 2 });
  });
});
