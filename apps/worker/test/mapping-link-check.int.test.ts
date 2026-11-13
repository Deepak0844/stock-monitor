import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createMappingRepository, createNotificationRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { createBrowserClient } from "@stock-monitor/browser-client";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN, type FakeBrowserService } from "@stock-monitor/browser-client/testing";
import { createLogger } from "@stock-monitor/shared";
import { sealSessionState, unsealSessionState } from "@stock-monitor/supplier-session";
import { checkLink, checkSupplierLinks, type LinkCheckDeps } from "../src/mapping-link-check.js";

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
const deps = (over: Partial<LinkCheckDeps> = {}): LinkCheckDeps => ({
  mappings: maps(),
  suppliers: suppliers(),
  supplierSessions: createSupplierSessionRepository(t.appDb),
  notifications: createNotificationRepository(t.appDb),
  audit: createAuditWriter(t.appDb),
  browser: createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 2000 }),
  key,
  logger,
  sleep: async (ms) => {
    sleeps.push(ms);
    await onSleep();
  },
  now: () => now,
  ...over,
});

let acme = "";
const addVariant = (id: string) =>
  t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ($1, 'p1', 'Tee', $2, '[]', $1, $3, true, 'DENY')`,
    [id, `Variant ${id}`, `inv-${id}`],
  );
const link = async (id: string, path = id) => {
  await addVariant(id);
  const r = await maps().create({ variantId: id, supplierId: acme, url: `https://shop.acme.example/p/${path}`, note: null });
  if (!r.ok) throw new Error("setup");
  return r.mapping.id;
};
const normal = { result: "ok", status: 200, title: "Blue Widget", heading: "Blue Widget", softNotFound: false };
const gone = { ...normal, status: 404, title: "Not found", heading: "Not found", softNotFound: true };
const checks = () => fake.requests.filter((r) => r.path === "/check-page");
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
  Object.assign(fake.behaviour, { checkPage: "ok", page: normal, pageFor: undefined, refreshed: undefined, delayMs: 0 });
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: "https://shop.acme.example/login", checkIntervalMinutes: 60 });
  if (!a.ok) throw new Error("setup");
  acme = a.supplier.id;
  await createSupplierSessionRepository(t.appDb).save(acme, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(acme);
  await suppliers().setPermission(acme, { status: "granted", note: null });
});

describe("a refreshed session", () => {
  it("is kept after a link check that found a logged-in page", async () => {
    const fresh = { cookies: [{ name: "session", value: "REFRESHED", domain: "shop.acme.example", path: "/" }], origins: [] };
    fake.behaviour.refreshed = fresh;
    await checkLink(deps(), await link("v1"));
    const stored = unsealSessionState((await createSupplierSessionRepository(t.appDb).getSealed(acme))!, key);
    expect(stored.cookies).toEqual(expect.arrayContaining(fresh.cookies));
  });
});

describe("one link", () => {
  it("opens the page with the saved session and records that it works", async () => {
    const id = await link("v1");
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "works" });
    expect(checks()[0]?.body).toMatchObject({ url: "https://shop.acme.example/p/v1", loginUrl: "https://shop.acme.example/login", state });
    expect(await mapping(id)).toMatchObject({ linkStatus: "works", workedTitle: "Blue Widget", lastLinkCheckAt: T0 });
  });

  it("a page that is gone, on a link that worked, counts as missing once", async () => {
    const id = await link("v1");
    await checkLink(deps(), id);
    fake.behaviour.page = gone;
    now = new Date(T0.getTime() + 3_600_000);
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "page_missing" });
    expect(await mapping(id)).toMatchObject({ linkStatus: "page_missing", missingChecks: 1 });
  });

  it("a wrong address that never worked is never worked, not missing", async () => {
    const id = await link("v1");
    fake.behaviour.page = gone;
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "never_worked" });
    expect(await mapping(id)).toMatchObject({ missingChecks: 0 });
  });

  it("a page that shows a puzzle is never a broken link, and the supplier is marked as needing the owner", async () => {
    const id = await link("v1");
    await checkLink(deps(), id);
    fake.behaviour.page = { ...normal, result: "captcha", status: 403, finalUrl: null, title: null, heading: null };
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "needs_login" });
    expect(await mapping(id)).toMatchObject({ linkStatus: "needs_login", missingChecks: 0 });
    expect(await suppliers().get(acme)).toMatchObject({ sessionStatus: "blocked", enabled: false, pausedReason: "session" });
    expect(await createNotificationRepository(t.appDb).listOpen()).toMatchObject([{ kind: "supplier_needs_reconnect", supplierId: acme, reason: "captcha" }]);
  });

  it("a login page marks the supplier as needing to reconnect, though the home page looked fine", async () => {
    const id = await link("v1");
    fake.behaviour.page = { ...normal, result: "login_required", status: 200, finalUrl: null, title: null, heading: null };
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "needs_login" });
    expect(await suppliers().get(acme)).toMatchObject({ sessionStatus: "needs_reconnect" });
  });

  it("a browser service that does not answer means could not check", async () => {
    const id = await link("v1");
    fake.behaviour.checkPage = "fail";
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "could_not_check" });
  });

  it.each([
    ["permission not recorded", async () => void (await suppliers().setPermission(acme, { status: "unknown", note: null })), "no_permission"],
    ["permission refused", async () => void (await suppliers().setPermission(acme, { status: "not_granted", note: null })), "no_permission"],
    ["supplier paused", async () => void (await suppliers().pause(acme)), "paused"],
    ["supplier not connected", async () => void (await createSupplierSessionRepository(t.appDb).remove(acme)), "not_connected"],
  ])("does not touch the supplier when %s", async (_name, change, reason) => {
    const id = await link("v1");
    await change();
    expect(await checkLink(deps(), id)).toEqual({ kind: "skipped", reason });
    expect(checks()).toHaveLength(0);
  });

  it("skips a link the owner switched off, and one that no longer exists", async () => {
    const id = await link("v1");
    await maps().update(id, { enabled: false });
    expect(await checkLink(deps(), id)).toEqual({ kind: "skipped", reason: "link_off" });
    expect(await checkLink(deps(), "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "skipped", reason: "no_mapping" });
  });

  it("audits the result without the address, the session or any page content", async () => {
    const id = await link("v1");
    await checkLink(deps(), id);
    const rows = (await t.pool.query("select details from audit_events where action = 'mapping.link_checked'")).rows;
    expect(rows[0].details).toEqual({ status: "works" });
    const everything = JSON.stringify([rows, (await t.pool.query("select * from mappings")).rows, logLines]);
    expect(everything).not.toContain(COOKIE);
  });
});

describe("all of a supplier's links", () => {
  it("waits the supplier's pause between pages, not before the first or after the last", async () => {
    await suppliers().setPermission(acme, { status: "granted", note: null, pauseSeconds: 7 });
    await link("v1");
    await link("v2");
    await link("v3");
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 3, supplierWide: false });
    expect(sleeps).toEqual([7000, 7000]);
    expect(checks()).toHaveLength(3);
  });

  it("calls a run where many links go missing at once a supplier-wide problem, and counts none of them", async () => {
    const ids: string[] = [];
    for (const n of ["a", "b", "c", "d", "e"]) ids.push(await link(n));
    for (const id of ids) await checkLink(deps(), id); // all worked
    fake.behaviour.page = gone;
    now = new Date(T0.getTime() + 8 * 3_600_000);
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 5, supplierWide: true });
    for (const id of ids) expect(await mapping(id)).toMatchObject({ linkStatus: "page_missing", missingChecks: 0, firstMissingAt: null });
  });

  it("counts a few missing links normally", async () => {
    const ids: string[] = [];
    for (const n of ["a", "b", "c", "d", "e"]) ids.push(await link(n));
    for (const id of ids) await checkLink(deps(), id);
    fake.behaviour.pageFor = (url) => (url.endsWith("/a") ? gone : undefined);
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ supplierWide: false });
    expect(await mapping(ids[0]!)).toMatchObject({ linkStatus: "page_missing", missingChecks: 1 });
    expect(await mapping(ids[1]!)).toMatchObject({ linkStatus: "works" });
  });

  it("stops when the supplier is paused while the run waits", async () => {
    await link("v1");
    await link("v2");
    onSleep = async () => void (await suppliers().pause(acme));
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 1 });
    expect(checks()).toHaveLength(1);
  });

  it("is refused for a supplier that is not allowed, without touching it", async () => {
    await link("v1");
    await suppliers().setPermission(acme, { status: "unknown", note: null });
    expect(await checkSupplierLinks(deps(), acme)).toEqual({ kind: "skipped", reason: "no_permission" });
    expect(checks()).toHaveLength(0);
  });

  it("leaves out links the owner switched off", async () => {
    const id = await link("v1");
    await link("v2");
    await maps().update(id, { enabled: false });
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ checked: 1 });
  });

  it("does nothing for a supplier that was deleted while the job waited", async () => {
    expect(await checkSupplierLinks(deps(), "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "skipped", reason: "no_supplier" });
  });
});
