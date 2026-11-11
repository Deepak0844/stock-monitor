import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createCaptureRepository, createMappingRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createBrowserClient } from "@stock-monitor/browser-client";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN, type FakeBrowserService } from "@stock-monitor/browser-client/testing";
import { createLogger } from "@stock-monitor/shared";
import { sealSessionState } from "@stock-monitor/supplier-session";
import { handleCapture, type CaptureDeps } from "../src/extraction-capture.js";

let t: TestDb;
let fake: FakeBrowserService;
const key = randomBytes(32);
const logLines: string[] = [];
const logger = createLogger({ level: "debug", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });
const COOKIE = "COOKIE-SECRET-MARKER-3a7c";
const state = { cookies: [{ name: "session", value: COOKIE, domain: "shop.acme.example", path: "/" }], origins: [] };

const suppliers = () => createSupplierRepository(t.appDb);
const captures = () => createCaptureRepository(t.appDb);
const deps = (over: Partial<CaptureDeps> = {}): CaptureDeps => ({
  captures: captures(),
  mappings: createMappingRepository(t.appDb),
  suppliers: suppliers(),
  supplierSessions: createSupplierSessionRepository(t.appDb),
  browser: createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 2000 }),
  key,
  logger,
  ...over,
});
let acme = "";
let link = "";
const pending = async () => (await captures().create({ supplierId: acme, mappingId: link, name: "Blue Tee" })).id;
const captureRequests = () => fake.requests.filter((r) => r.path === "/capture");

beforeAll(async () => {
  t = await startTestDb();
  fake = await createFakeBrowserService();
}, 180_000);
afterAll(async () => {
  await fake?.close();
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants cascade");
  fake.requests.length = 0;
  logLines.length = 0;
  Object.assign(fake.behaviour, { capture: "ok", page: { result: "ok", status: 200, title: "Blue Tee", heading: "Blue Tee", softNotFound: false }, pageFor: undefined, delayMs: 0 });
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: "https://shop.acme.example/login", checkIntervalMinutes: 60 });
  if (!a.ok) throw new Error("setup");
  acme = a.supplier.id;
  await createSupplierSessionRepository(t.appDb).save(acme, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(acme);
  await suppliers().setPermission(acme, { status: "granted", note: null });
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ('v1', 'p1', 'Tee', 'L', '[]', 'S1', 'i1', true, 'DENY')`,
  );
  const m = await createMappingRepository(t.appDb).create({ variantId: "v1", supplierId: acme, url: "https://shop.acme.example/p/blue", note: null });
  if (!m.ok) throw new Error("setup");
  link = m.mapping.id;
});

describe("a capture job", () => {
  it("opens the link's page with the saved session, asks for a picture, and stores what it saw", async () => {
    const id = await pending();
    expect(await handleCapture(deps(), id)).toEqual({ kind: "ready" });
    expect(captureRequests()[0]?.body).toMatchObject({ url: "https://shop.acme.example/p/blue", loginUrl: "https://shop.acme.example/login", state, picture: true });
    const c = await captures().get(id);
    expect(c).toMatchObject({ status: "ready", pageClass: "ok", hasPicture: true });
    expect(c?.description).toMatchObject({ url: "https://shop.acme.example/p/blue", title: "Blue Tee", status: 200, pageClass: "ok", buttons: [{ label: "Add to cart", enabled: true, section: "Blue Tee" }] });
    expect((await captures().picture(id))?.toString()).toBe("PNG-bytes");
  });

  it.each([
    ["login_required", "login_required"],
    ["captcha", "captcha"],
    ["blocked", "blocked"],
    ["unreachable", "unreachable"],
  ])("a %s page is not saved as a page: the capture fails with that fixed reason", async (result, reason) => {
    fake.behaviour.page = { result, status: 403, finalUrl: null, title: null, heading: null, softNotFound: false };
    const id = await pending();
    expect(await handleCapture(deps(), id)).toEqual({ kind: "failed", reason });
    expect(await captures().get(id)).toMatchObject({ status: "failed", failureReason: reason, hasPicture: false, description: null });
  });

  it("a page that is not clear is still saved, so the owner can look at it", async () => {
    fake.behaviour.page = { result: "unknown", status: 200, title: "Blue Tee", heading: "Blue Tee", softNotFound: false };
    expect(await handleCapture(deps(), await pending())).toEqual({ kind: "ready" });
  });

  it("a busy browser fails the capture with its own reason", async () => {
    fake.behaviour.capture = "busy";
    const id = await pending();
    expect(await handleCapture(deps(), id)).toEqual({ kind: "failed", reason: "browser_busy" });
    expect(await captures().get(id)).toMatchObject({ status: "failed", failureReason: "browser_busy" });
  });

  it("a browser service that does not answer fails the capture", async () => {
    fake.behaviour.capture = "fail";
    const id = await pending();
    expect(await handleCapture(deps(), id)).toEqual({ kind: "failed", reason: "browser_unavailable" });
    expect(await captures().get(id)).toMatchObject({ status: "failed", failureReason: "browser_unavailable" });
  });

  it.each([
    ["permission is not recorded", () => suppliers().setPermission(acme, { status: "unknown", note: null }), "no_permission"],
    ["the supplier is paused", () => suppliers().pause(acme), "paused"],
    ["the supplier has no login", () => createSupplierSessionRepository(t.appDb).remove(acme), "not_connected"],
  ])("does not touch the supplier when %s", async (_n, change, reason) => {
    const id = await pending();
    await change();
    expect(await handleCapture(deps(), id)).toEqual({ kind: "failed", reason });
    expect(captureRequests()).toHaveLength(0);
  });

  it("fails when the link was deleted while the job waited", async () => {
    const id = await pending();
    await createMappingRepository(t.appDb).remove(link);
    expect(await handleCapture(deps(), id)).toEqual({ kind: "failed", reason: "link_not_found" });
  });

  it("does nothing for a capture that is gone or already done, so a repeated job is harmless", async () => {
    expect(await handleCapture(deps(), "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "skipped" });
    const id = await pending();
    await handleCapture(deps(), id);
    fake.requests.length = 0;
    expect(await handleCapture(deps(), id)).toEqual({ kind: "skipped" });
    expect(captureRequests()).toHaveLength(0);
  });

  it("never puts the session or the page in a log", async () => {
    await handleCapture(deps(), await pending());
    const all = logLines.join("");
    expect(all).not.toContain(COOKIE);
    expect(all).not.toContain("Soft cotton");
    expect(all).not.toContain("PNG-bytes");
  });
});
