import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import {
  createCaptureRepository, createCheckRunRepository, createMappingRepository, createNotificationRepository, createObservationRepository, createRecipeRepository,
  createSupplierRepository, createSupplierSessionRepository,
} from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { createBrowserClient } from "@stock-monitor/browser-client";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN, type FakeBrowserService } from "@stock-monitor/browser-client/testing";
import { createLogger } from "@stock-monitor/shared";
import { sealSessionState } from "@stock-monitor/supplier-session";
import { checkStock, checkSupplierStock, type StockCheckDeps } from "../src/extraction-check.js";

let t: TestDb;
let fake: FakeBrowserService;
const key = randomBytes(32);
const logLines: string[] = [];
const logger = createLogger({ level: "debug", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });
const sleeps: number[] = [];
let onSleep: () => Promise<void> | void = () => {};
const COOKIE = "COOKIE-SECRET-MARKER-3a7c";
const state = { cookies: [{ name: "session", value: COOKIE, domain: "shop.acme.example", path: "/" }], origins: [] };
const T0 = new Date("2026-11-10T08:00:00Z");
let now = T0;

const suppliers = () => createSupplierRepository(t.appDb);
const maps = () => createMappingRepository(t.appDb);
const observations = () => createObservationRepository(t.appDb);
const notes = () => createNotificationRepository(t.appDb);
const deps = (over: Partial<StockCheckDeps> = {}): StockCheckDeps => ({
  mappings: maps(), suppliers: suppliers(), supplierSessions: createSupplierSessionRepository(t.appDb), recipes: createRecipeRepository(t.appDb),
  observations: observations(), captures: createCaptureRepository(t.appDb), notifications: notes(), audit: createAuditWriter(t.appDb),
  checkRuns: createCheckRunRepository(t.appDb), timezone: "UTC", random: () => 0,
  browser: createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 2000 }), key, logger,
  sleep: async (ms) => { sleeps.push(ms); await onSleep(); }, now: () => now, ...over,
});

const rules = { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [{ type: "button", label: "Add to cart", enabled: true }], outOfStock: [{ type: "text", text: "Sold out" }] };
const inStock = { sections: [{ heading: "Blue Tee", level: 1, lines: ["Soft cotton."] }], buttons: [{ label: "Add to cart", enabled: true, section: "Blue Tee" }] };
const soldOut = { sections: [{ heading: "Blue Tee", level: 1, lines: ["Sold out"] }], buttons: [{ label: "Add to cart", enabled: false, section: "Blue Tee" }] };
const changed = { sections: [{ heading: "Something new", level: 1, lines: ["Whatever"] }], buttons: [] };
const normal = { result: "ok", status: 200, title: "Blue Tee", heading: "Blue Tee", softNotFound: false };
const gone = { result: "ok", status: 404, title: "Not found", heading: "Not found", softNotFound: true };

let acme = "";
const addVariant = (id: string) =>
  t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ($1, 'p1', 'Tee', $1, '[]', $1, $2, true, 'DENY')`,
    [id, `inv-${id}`],
  );
const link = async (id: string, region?: string) => {
  await addVariant(id);
  const r = await maps().create({ variantId: id, supplierId: acme, url: `https://shop.acme.example/p/${id}`, note: null, region: region ?? null });
  if (!r.ok) throw new Error("setup");
  return r.mapping.id;
};
const turnOn = async (r: unknown = rules) => {
  const saved = await createRecipeRepository(t.appDb).create(acme, r);
  await createRecipeRepository(t.appDb).activate(saved.id);
  return saved.version;
};
const runs = () => createCheckRunRepository(t.appDb);
/** A whole-supplier run, the way the API or the tick starts one: the run row first, then the job. */
const runAll = async (over: Partial<StockCheckDeps> = {}, supplierId = acme) => {
  const row = supplierId === acme ? await runs().start(acme, "manual", 0) : null;
  return checkSupplierStock(deps(over), supplierId, row?.id ?? randomUUID());
};
const requests = (path: string) => fake.requests.filter((r) => r.path === path);
const latest = async (id: string) => (await observations().listFor(id))[0]!;
const mapping = async (id: string) => (await maps().get(id))!;

beforeAll(async () => {
  t = await startTestDb();
  fake = await createFakeBrowserService();
}, 180_000);
afterAll(async () => {
  await fake?.close();
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, audit_events cascade");
  fake.requests.length = 0;
  logLines.length = 0;
  sleeps.length = 0;
  onSleep = () => {};
  now = T0;
  Object.assign(fake.behaviour, { capture: "ok", page: normal, pageFor: undefined, description: inStock, descriptionFor: undefined, delayMs: 0 });
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: "https://shop.acme.example/login", checkIntervalMinutes: 60 });
  if (!a.ok) throw new Error("setup");
  acme = a.supplier.id;
  await createSupplierSessionRepository(t.appDb).save(acme, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(acme);
  await suppliers().setPermission(acme, { status: "granted", note: null });
});

describe("one link", () => {
  it("in stock: one visit stores the answer with the recipe version, and updates the link status from the same visit", async () => {
    const id = await link("v1");
    const version = await turnOn();
    expect(await checkStock(deps(), id)).toEqual({ kind: "checked", answer: "in_stock", reason: null });
    expect(requests("/capture")).toHaveLength(1);
    expect(requests("/check-page")).toHaveLength(0);
    expect(await latest(id)).toMatchObject({ answer: "in_stock", matchedText: "Add to cart", recipeVersion: version, checkResult: "ok", quantityMismatch: false });
    expect(await mapping(id)).toMatchObject({ linkStatus: "works", lastLinkCheckAt: T0 });
    expect(requests("/capture")[0]?.body).toMatchObject({ url: "https://shop.acme.example/p/v1", loginUrl: "https://shop.acme.example/login", state });
  });

  it("out of stock", async () => {
    const id = await link("v1");
    await turnOn();
    fake.behaviour.description = soldOut;
    expect(await checkStock(deps(), id)).toMatchObject({ answer: "out_of_stock" });
    expect(await latest(id)).toMatchObject({ answer: "out_of_stock", matchedText: "Sold out" });
  });

  it("a page that changed is cannot tell, never out of stock, and its capture is kept for the owner", async () => {
    const id = await link("v1");
    await turnOn();
    fake.behaviour.description = changed;
    expect(await checkStock(deps(), id)).toEqual({ kind: "checked", answer: "cannot_tell", reason: "page_changed" });
    const o = await latest(id);
    expect(o).toMatchObject({ answer: "cannot_tell", reason: "page_changed", matchedText: null });
    expect(o.captureId).not.toBeNull();
    const kept = await createCaptureRepository(t.appDb).list(acme);
    expect(kept).toMatchObject([{ keptReason: "page_changed", hasPicture: true, mappingId: id }]);
  });

  it.each(["login_required", "captcha", "blocked", "unreachable"])("a %s page is cannot tell, with the visit's result, and the supplier's own status is left alone", async (result) => {
    const id = await link("v1");
    await turnOn();
    fake.behaviour.page = { result, status: 403, finalUrl: null, title: null, heading: null, softNotFound: false };
    expect(await checkStock(deps(), id)).toEqual({ kind: "checked", answer: "cannot_tell", reason: "check_failed" });
    expect(await latest(id)).toMatchObject({ answer: "cannot_tell", reason: "check_failed", checkResult: result });
    expect(await suppliers().get(acme)).toMatchObject({ sessionStatus: "connected", enabled: true, pausedReason: null });
    expect((await notes().listOpen()).length).toBe(0);
  });

  it("a browser service that does not answer is cannot tell", async () => {
    const id = await link("v1");
    await turnOn();
    fake.behaviour.capture = "fail";
    expect(await checkStock(deps(), id)).toEqual({ kind: "checked", answer: "cannot_tell", reason: "check_failed" });
    expect(await latest(id)).toMatchObject({ checkResult: "service_unavailable" });
    expect(await mapping(id)).toMatchObject({ linkStatus: "could_not_check" });
  });

  it("a 404 on a link that worked is page missing, and on one that never worked is never worked: neither is out of stock", async () => {
    const worked = await link("v1");
    const never = await link("v2");
    await turnOn();
    await checkStock(deps(), worked); // it worked once
    fake.behaviour.page = gone;
    fake.behaviour.description = { sections: [{ heading: "Not found", level: 1, lines: ["Sold out"] }], buttons: [] };
    now = new Date(T0.getTime() + 3_600_000);
    expect(await checkStock(deps(), worked)).toEqual({ kind: "checked", answer: "cannot_tell", reason: "page_missing" });
    expect(await mapping(worked)).toMatchObject({ linkStatus: "page_missing", missingChecks: 1 });
    expect(await checkStock(deps(), never)).toEqual({ kind: "checked", answer: "cannot_tell", reason: "never_worked" });
    expect(await mapping(never)).toMatchObject({ linkStatus: "never_worked", missingChecks: 0 });
  });

  it("uses the link's region, else the supplier's default, from the same visit", async () => {
    const regional = { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [], outOfStock: [], region: { under: "Stores" } };
    await turnOn(regional);
    fake.behaviour.description = { sections: [{ heading: "Blue Tee", level: 1, lines: [] }, { heading: "Stores", level: 2, lines: ["Hull\t5", "Bristol\t0"] }], buttons: [] };
    const own = await link("v1", "Hull");
    const byDefault = await link("v2");
    const missing = await link("v3", "Manchester");
    await suppliers().setRegion(acme, "Bristol");
    expect(await checkStock(deps(), own)).toMatchObject({ answer: "in_stock" });
    expect(await latest(own)).toMatchObject({ quantity: 5 });
    expect(await checkStock(deps(), byDefault)).toMatchObject({ answer: "out_of_stock" });
    expect(await checkStock(deps(), missing)).toEqual({ kind: "checked", answer: "out_of_stock", reason: "not_listed" });
  });

  it("is refused without touching the supplier when it is not allowed, not connected, paused, has no active recipe, or the link is off", async () => {
    const id = await link("v1");
    expect(await checkStock(deps(), id)).toEqual({ kind: "skipped", reason: "no_recipe" });
    await turnOn();
    await suppliers().setPermission(acme, { status: "unknown", note: null });
    expect(await checkStock(deps(), id)).toEqual({ kind: "skipped", reason: "no_permission" });
    await suppliers().setPermission(acme, { status: "granted", note: null });
    await suppliers().pause(acme);
    expect(await checkStock(deps(), id)).toEqual({ kind: "skipped", reason: "paused" });
    await suppliers().resume(acme);
    await createSupplierSessionRepository(t.appDb).remove(acme);
    expect(await checkStock(deps(), id)).toEqual({ kind: "skipped", reason: "not_connected" });
    await maps().update(id, { enabled: false });
    expect(await checkStock(deps(), id)).toEqual({ kind: "skipped", reason: "link_off" });
    expect(await checkStock(deps(), "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "skipped", reason: "no_mapping" });
    expect(requests("/capture")).toHaveLength(0);
  });

  it("records the version that was on when it ran", async () => {
    const id = await link("v1");
    await turnOn();
    const two = await turnOn({ ...rules, outOfStock: [] });
    await checkStock(deps(), id);
    expect(await latest(id)).toMatchObject({ recipeVersion: two });
  });

  it("never puts the session, the page or the picture in a log, the audit log or the observation", async () => {
    const id = await link("v1");
    await turnOn();
    fake.behaviour.description = changed;
    await checkStock(deps(), id);
    const everything = JSON.stringify([logLines, (await t.pool.query("select * from audit_events")).rows, (await t.pool.query("select * from stock_observations")).rows]);
    for (const secret of [COOKIE, "Whatever", "PNG-bytes", Buffer.from("PNG-bytes").toString("base64")]) expect(everything).not.toContain(secret);
  });
});

describe("all of a supplier's links", () => {
  it("waits the supplier's pause between pages and stores an observation for each", async () => {
    await suppliers().setPermission(acme, { status: "granted", note: null, pauseSeconds: 7 });
    await turnOn();
    for (const n of ["v1", "v2", "v3"]) await link(n);
    expect(await runAll()).toMatchObject({ kind: "done", checked: 3, supplierWide: false });
    expect(sleeps).toEqual([7000, 7000]);
    expect(requests("/capture")).toHaveLength(3);
    expect(Number((await t.pool.query("select count(*) from stock_observations")).rows[0].count)).toBe(3);
  });

  it("raises one notification when many links have changed pages, and none per link", async () => {
    await turnOn();
    for (const n of ["a", "b", "c", "d", "e", "f"]) await link(n);
    fake.behaviour.description = changed;
    expect(await runAll()).toMatchObject({ checked: 6, supplierWide: true });
    const open = await notes().listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "recipe_needs_review", supplierId: acme, reason: "page_changed" });
    expect(open[0]?.message).toContain("Acme");
    expect(open[0]?.message).toMatch(/stock rules/);
  });

  it("a later good run resolves that notification", async () => {
    await turnOn();
    for (const n of ["a", "b", "c", "d", "e", "f"]) await link(n);
    fake.behaviour.description = changed;
    await runAll();
    fake.behaviour.description = inStock;
    await runAll();
    expect(await notes().listOpen()).toHaveLength(0);
  });

  it("a few changed pages raise nothing", async () => {
    await turnOn();
    for (const n of ["a", "b", "c", "d", "e"]) await link(n);
    fake.behaviour.descriptionFor = (url) => (url.endsWith("/a") ? changed : undefined);
    expect(await runAll()).toMatchObject({ supplierWide: false });
    expect(await notes().listOpen()).toHaveLength(0);
  });

  it("a single link check never raises the notification", async () => {
    const id = await link("v1");
    await turnOn();
    fake.behaviour.description = changed;
    await checkStock(deps(), id);
    expect(await notes().listOpen()).toHaveLength(0);
  });

  it("stops when the supplier is paused while the run waits", async () => {
    await turnOn();
    await link("v1");
    await link("v2");
    onSleep = async () => void (await suppliers().pause(acme));
    expect(await runAll()).toMatchObject({ kind: "done", checked: 1 });
    expect(requests("/capture")).toHaveLength(1);
  });

  it("is refused for a supplier that is not allowed or has no active recipe, and for one that was deleted", async () => {
    await link("v1");
    expect(await runAll()).toEqual({ kind: "skipped", reason: "no_recipe" });
    await turnOn();
    await suppliers().setPermission(acme, { status: "unknown", note: null });
    expect(await runAll()).toEqual({ kind: "skipped", reason: "no_permission" });
    expect(await runAll({}, "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "skipped", reason: "no_supplier" });
    expect(requests("/capture")).toHaveLength(0);
  });

  it("leaves out links the owner switched off", async () => {
    await turnOn();
    const off = await link("v1");
    await link("v2");
    await maps().update(off, { enabled: false });
    expect(await runAll()).toMatchObject({ checked: 1 });
  });

  it("deletes old unlabelled captures when a run starts", async () => {
    await turnOn();
    const id = await link("v1");
    const old = await createCaptureRepository(t.appDb).create({ supplierId: acme, mappingId: id, name: "old" });
    await t.pool.query("update page_captures set created_at = now() - interval '31 days' where id = $1", [old.id]);
    await runAll();
    expect(await createCaptureRepository(t.appDb).get(old.id)).toBeNull();
  });
});

describe("run records and stop rules", () => {
  const MIN = 60_000;
  const useSchedule = () => suppliers().setSchedule(acme, { intervalMinutes: 1440, window: null, nextCheckAt: null });
  const lastRun = async () => (await runs().recent(acme, 1))[0]!;
  const supplier = async () => (await suppliers().get(acme))!;
  const unreachable = { result: "unreachable", status: null, finalUrl: null, title: null, heading: null, softNotFound: false };
  const links = async (n: number) => {
    for (let i = 1; i <= n; i++) await link(`r${i}`);
  };

  it("counts what the pages said, and the counts match the observations", async () => {
    await turnOn();
    await links(3);
    fake.behaviour.descriptionFor = (url) => (url.endsWith("/r1") ? soldOut : url.endsWith("/r2") ? changed : undefined);
    expect(await runAll()).toMatchObject({ kind: "done", checked: 3, stopped: null });
    expect(await lastRun()).toMatchObject({ outcome: "finished", stopReason: null, linksDone: 3, inStock: 1, outOfStock: 1, cannotTell: 1 });
  });

  it("records progress after each page", async () => {
    await turnOn();
    await links(3);
    const seen: number[] = [];
    onSleep = async () => void seen.push((await runs().current(acme))!.linksDone);
    await runAll();
    expect(seen).toEqual([1, 2]);
  });

  it("a login page stops the run at once, asks for a reconnect, and moves nothing else", async () => {
    await turnOn();
    await useSchedule();
    await links(4);
    fake.behaviour.pageFor = (url) => (url.endsWith("/r2") ? { result: "login_required", status: 200, finalUrl: null, title: null, heading: null, softNotFound: false } : undefined);
    expect(await runAll()).toMatchObject({ kind: "done", checked: 2, stopped: "login_required" });
    expect(requests("/capture")).toHaveLength(2);
    expect(await lastRun()).toMatchObject({ outcome: "stopped", stopReason: "login_required" });
    expect(await supplier()).toMatchObject({ sessionStatus: "needs_reconnect", enabled: false, pausedReason: "session", failureCount: 0, nextCheckAt: null });
    expect(await notes().listOpen()).toMatchObject([{ kind: "supplier_needs_reconnect", supplierId: acme, reason: "login_required" }]);
    expect(await runAll()).toEqual({ kind: "skipped", reason: "needs_attention" });
  });

  it.each(["captcha", "blocked"])("a %s page stops the run, blocks the supplier, and is never tried again", async (result) => {
    await turnOn();
    await links(3);
    fake.behaviour.page = { result, status: 403, finalUrl: null, title: null, heading: null, softNotFound: false };
    expect(await runAll()).toMatchObject({ checked: 1, stopped: result });
    expect(requests("/capture")).toHaveLength(1);
    expect(await supplier()).toMatchObject({ sessionStatus: "blocked", enabled: false });
    expect(await runAll()).toMatchObject({ kind: "skipped" });
    expect(requests("/capture")).toHaveLength(1);
  });

  it("stops after three unreachable pages in a row, then backs off 15 minutes, 1 hour, 4 hours, 4 hours", async () => {
    await turnOn();
    await useSchedule();
    await links(5);
    fake.behaviour.page = unreachable;
    const waits: number[] = [];
    for (const expected of [15, 60, 240, 240]) {
      expect(await runAll()).toMatchObject({ checked: 3, stopped: "unreachable" });
      waits.push(((await supplier()).nextCheckAt!.getTime() - now.getTime()) / MIN);
      expect(waits.at(-1)).toBe(expected);
    }
    expect(await supplier()).toMatchObject({ failureCount: 4, sessionStatus: "connected", enabled: true });
    expect(await lastRun()).toMatchObject({ outcome: "stopped", stopReason: "unreachable" });
  });

  it("a success after failures resets the backoff and schedules one interval ahead", async () => {
    await turnOn();
    await useSchedule();
    await links(5);
    fake.behaviour.page = unreachable;
    await runAll();
    fake.behaviour.page = normal;
    expect(await runAll()).toMatchObject({ checked: 5, stopped: null });
    expect(await supplier()).toMatchObject({ failureCount: 0, nextCheckAt: new Date(now.getTime() + 1440 * MIN) });
  });

  it("two unreachable pages and then a good one do not stop the run", async () => {
    await turnOn();
    await links(5);
    fake.behaviour.pageFor = (url) => (/\/r[12]$/.test(url) ? unreachable : undefined);
    expect(await runAll()).toMatchObject({ checked: 5, stopped: null });
  });

  it("a supplier with no enabled links ends at once with zero counts, and still moves the next check", async () => {
    await turnOn();
    await useSchedule();
    expect(await runAll()).toMatchObject({ kind: "done", checked: 0, stopped: null });
    expect(await lastRun()).toMatchObject({ outcome: "finished", linksDone: 0 });
    expect((await supplier()).nextCheckAt).toEqual(new Date(now.getTime() + 1440 * MIN));
  });

  it("a manual run with automatic checks off leaves the next check empty", async () => {
    await turnOn();
    await links(1);
    await runAll();
    expect((await supplier()).nextCheckAt).toBeNull();
  });

  it("a supplier paused between pages ends the run as stopped, without visiting again", async () => {
    await turnOn();
    await links(2);
    onSleep = async () => void (await suppliers().pause(acme));
    expect(await runAll()).toMatchObject({ checked: 1, stopped: "supplier_not_ready" });
    expect(await lastRun()).toMatchObject({ outcome: "stopped", stopReason: "supplier_not_ready" });
  });

  it("an unexpected error ends the run as failed with a code, backs off, and puts nothing from the page in the record", async () => {
    await turnOn();
    await useSchedule();
    await links(2);
    const broken = { ...maps(), forSupplier: async () => { throw new Error(`boom https://shop.acme.example/p ${COOKIE}`); } } as never;
    expect(await runAll({ mappings: broken })).toEqual({ kind: "failed" });
    expect(await lastRun()).toMatchObject({ outcome: "failed", stopReason: "error" });
    expect(await supplier()).toMatchObject({ failureCount: 1, nextCheckAt: new Date(now.getTime() + 15 * MIN) });
    const everything = JSON.stringify([(await t.pool.query("select * from check_runs")).rows, (await t.pool.query("select details from audit_events")).rows, logLines]);
    expect(everything).not.toContain(COOKIE);
    expect(everything).not.toContain("shop.acme.example/p");
  });

  it("run rows hold counts and a code, never an address or session", async () => {
    await turnOn();
    await links(2);
    await runAll();
    const rows = JSON.stringify((await t.pool.query("select * from check_runs")).rows);
    expect(rows).not.toContain("acme.example");
    expect(rows).not.toContain(COOKIE);
  });
});
