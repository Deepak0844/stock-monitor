import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createMappingRepository, createObservationRepository, createProposalRepository, createShopifyRepository, createSupplierRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { createProposalsEvaluateHandler } from "../src/proposals-evaluate.js";

let t: TestDb;
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const NOW = new Date("2026-06-10T10:00:00Z");
const HOUR = 3_600_000;
const proposals = () => createProposalRepository(t.appDb);
const mappings = () => createMappingRepository(t.appDb);
const observations = () => createObservationRepository(t.appDb);
const run = (payload: { supplierId?: string; mappingId?: string } = {}) =>
  createProposalsEvaluateHandler({ mappings: mappings(), observations: observations(), shopify: createShopifyRepository(t.appDb, { key: Buffer.alloc(32), keyId: "k" }), proposals: proposals(), logger, now: () => NOW })(payload);

let supplier = "";
let n = 0;
/** A link for a new variant with `available` in Shopify, and the supplier's latest answer. */
async function link(opts: { available: number | null; answer?: "in_stock" | "out_of_stock" | "cannot_tell" | null; reason?: string | null; mismatch?: boolean; tracked?: boolean; supplierId?: string; removed?: boolean; enabled?: boolean }) {
  const v = `v${++n}`;
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy, available, removed_at)
     values ($1, 'p1', 'Tee', $1, '[]', $1, $2, $3, 'DENY', $4, ${opts.removed ? "now()" : "null"})`,
    [v, `inv-${v}`, opts.tracked ?? true, opts.available],
  );
  const m = await mappings().create({ variantId: v, supplierId: opts.supplierId ?? supplier, url: `https://acme.example/${v}`, note: null });
  if (!m.ok) throw new Error("setup");
  if (opts.enabled === false) await mappings().update(m.mapping.id, { enabled: false });
  if (opts.answer) await answer(m.mapping.id, opts.answer, opts.reason ?? null, opts.mismatch ?? false);
  return { variantId: v, mappingId: m.mapping.id };
}
const answer = (mappingId: string, a: "in_stock" | "out_of_stock" | "cannot_tell", reason: string | null = null, mismatch = false) =>
  observations().append({ mappingId, answer: a, reason, quantity: null, matchedText: null, quantityMismatch: mismatch, recipeVersion: 1, checkResult: "ok", captureId: null });
const missing = (mappingId: string, over: { checkedHoursAfter?: number; missingChecks?: number } = {}) =>
  mappings().recordCheck(mappingId, {
    status: "page_missing", checkedAt: new Date(NOW.getTime()), lastWorkedAt: new Date(NOW.getTime() - 48 * HOUR), workedTitle: "Tee", workedHeading: null,
    missingChecks: over.missingChecks ?? 2, firstMissingAt: new Date(NOW.getTime() - (over.checkedHoursAfter ?? 7) * HOUR),
  });
const open = () => proposals().open();

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, app_settings, shopify_connection cascade");
  const s = await createSupplierRepository(t.appDb).create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  supplier = s.supplier.id;
  await t.pool.query(
    `insert into shopify_connection (id, shop, credential_type, credentials_ciphertext, credentials_iv, credentials_tag, credentials_key_id, location_id, location_name)
     values (true, 'x.myshopify.com', 'static_token', 'c', 'i', 't', 'k', 'gid://shopify/Location/1', 'Shop')`,
  );
});

describe("evaluate: each rule", () => {
  it("out of stock with stock in Shopify: set to 0", async () => {
    await link({ available: 4, answer: "out_of_stock" });
    await run();
    expect(await open()).toMatchObject([{ kind: "set_zero_out_of_stock", proposedQuantity: 0, shopifyQuantitySeen: 4, state: "open" }]);
  });

  it("region not listed: set to 0 with its own kind", async () => {
    await link({ available: 4, answer: "out_of_stock", reason: "not_listed" });
    await run();
    expect(await open()).toMatchObject([{ kind: "set_zero_not_listed" }]);
  });

  it("page missing: only once the link may be unavailable", async () => {
    const a = await link({ available: 4, answer: "cannot_tell", reason: "page_missing" });
    await missing(a.mappingId, { missingChecks: 1 });
    await run();
    expect(await open()).toEqual([]);
    await missing(a.mappingId);
    await run();
    expect(await open()).toMatchObject([{ kind: "set_zero_page_missing", proposedQuantity: 0 }]);
  });

  it("in stock with 0 in Shopify: the default quantity from the settings, and it expires after the set hours", async () => {
    await proposals().saveSettings({ defaultQuantity: 9, expiryHours: 6 });
    await link({ available: 0, answer: "in_stock" });
    await run();
    const [p] = await open();
    expect(p).toMatchObject({ kind: "restock", proposedQuantity: 9 });
    expect(p!.expiresAt.getTime()).toBe(NOW.getTime() + 6 * HOUR);
  });

  it("starts with 5 and 24 hours when nothing was set", async () => {
    await link({ available: 0, answer: "in_stock" });
    await run();
    const [p] = await open();
    expect(p).toMatchObject({ proposedQuantity: 5 });
    expect(p!.expiresAt.getTime()).toBe(NOW.getTime() + 24 * HOUR);
  });

  it("suggests nothing when Shopify already agrees", async () => {
    await link({ available: 3, answer: "in_stock" });
    await link({ available: 0, answer: "out_of_stock" });
    await run();
    expect(await open()).toEqual([]);
  });

  it("never suggests from a check that could not tell, or when quantity and wording disagree", async () => {
    await link({ available: 4, answer: "cannot_tell", reason: "page_changed" });
    await link({ available: 4, answer: "out_of_stock", mismatch: true });
    await link({ available: 4, answer: null });
    await run();
    expect(await open()).toEqual([]);
  });

  it("still suggests when Shopify is not tracking the item (the screen shows the warning)", async () => {
    await link({ available: 4, answer: "out_of_stock", tracked: false });
    await run();
    expect(await open()).toMatchObject([{ tracked: false }]);
  });

  it("suggests nothing when the item has no synced number", async () => {
    await link({ available: null, answer: "out_of_stock" });
    await run();
    expect(await open()).toEqual([]);
  });
});

describe("evaluate: keeping, replacing, closing", () => {
  it("running again changes nothing", async () => {
    await link({ available: 4, answer: "out_of_stock" });
    await run();
    const [first] = await open();
    await run();
    await run();
    expect((await open()).map((p) => p.id)).toEqual([first!.id]);
  });

  it("two runs at the same moment give one open suggestion", async () => {
    await link({ available: 4, answer: "out_of_stock" });
    await Promise.all([run(), run()]);
    expect(await open()).toHaveLength(1);
  });

  it("a newer answer replaces the open suggestion and keeps the old one in the history", async () => {
    const a = await link({ available: 4, answer: "out_of_stock" });
    await run();
    const [first] = await open();
    await t.pool.query("update shopify_variants set available = 0 where variant_id = $1", [a.variantId]);
    await answer(a.mappingId, "in_stock");
    await run();
    const [now] = await open();
    expect(now).toMatchObject({ kind: "restock" });
    expect(now!.id).not.toBe(first!.id);
    expect(await proposals().get(first!.id)).toMatchObject({ state: "replaced" });
  });

  it("a later check that cannot tell closes the open suggestion with that reason", async () => {
    const a = await link({ available: 4, answer: "out_of_stock" });
    await run();
    const [first] = await open();
    await answer(a.mappingId, "cannot_tell", "check_failed");
    await run();
    expect(await open()).toEqual([]);
    expect(await proposals().get(first!.id)).toMatchObject({ state: "replaced", closedReason: "could_not_tell" });
  });

  it("closes it when Shopify now agrees", async () => {
    const a = await link({ available: 4, answer: "out_of_stock" });
    await run();
    const [first] = await open();
    await t.pool.query("update shopify_variants set available = 0 where variant_id = $1", [a.variantId]);
    await run();
    expect(await proposals().get(first!.id)).toMatchObject({ state: "replaced", closedReason: "no_longer_needed" });
  });

  it("closes it when the link is turned off or the variant is removed from Shopify, without a crash", async () => {
    const a = await link({ available: 4, answer: "out_of_stock" });
    const b = await link({ available: 4, answer: "out_of_stock" });
    await run();
    await mappings().update(a.mappingId, { enabled: false });
    await t.pool.query("update shopify_variants set removed_at = now() where variant_id = $1", [b.variantId]);
    await run();
    expect(await open()).toEqual([]);
    expect((await proposals().history(10, 0)).map((p) => p.closedReason)).toEqual(["link_off", "link_off"]);
  });

  it("does not suggest for a link that is off or a removed variant to begin with", async () => {
    await link({ available: 4, answer: "out_of_stock", enabled: false });
    await link({ available: 4, answer: "out_of_stock", removed: true });
    await run();
    expect(await open()).toEqual([]);
  });

  it("does not suggest again after the owner rejected it, until a newer check", async () => {
    const a = await link({ available: 4, answer: "out_of_stock" });
    await run();
    const [first] = await open();
    await proposals().reject(first!.id, null, "owner", NOW);
    await run();
    expect(await open()).toEqual([]);
    await answer(a.mappingId, "out_of_stock");
    await run();
    expect(await open()).toHaveLength(1);
  });
});

describe("evaluate: scope and safety", () => {
  it("a supplier's id evaluates only that supplier's links, a link's id only that link", async () => {
    const other = await createSupplierRepository(t.appDb).create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
    if (!other.ok) throw new Error("setup");
    await link({ available: 4, answer: "out_of_stock" });
    const g1 = await link({ available: 4, answer: "out_of_stock", supplierId: other.supplier.id });
    await link({ available: 4, answer: "out_of_stock", supplierId: other.supplier.id });
    await run({ mappingId: g1.mappingId });
    expect(await open()).toHaveLength(1);
    await run({ supplierId: other.supplier.id });
    expect(await open()).toHaveLength(2);
    await run();
    expect(await open()).toHaveLength(3);
  });

  it("does nothing, and does not fail, when Shopify is not connected or has no location", async () => {
    await link({ available: 4, answer: "out_of_stock" });
    await t.pool.query("update shopify_connection set location_id = null, location_name = null");
    await run();
    expect(await open()).toEqual([]);
    await t.pool.query("delete from shopify_connection");
    await run();
    expect(await open()).toEqual([]);
  });

  it("an unknown link id does nothing", async () => {
    await run({ mappingId: "11111111-1111-4111-8111-111111111111" });
    expect(await open()).toEqual([]);
  });

  it("stores no page text: the suggestion row has numbers, kind and ids only", async () => {
    await link({ available: 4, answer: "out_of_stock" });
    await observations().append({ mappingId: (await mappings().list({}))[0]!.id, answer: "out_of_stock", reason: null, quantity: null, matchedText: "Sold out right now", quantityMismatch: false, recipeVersion: 1, checkResult: "ok", captureId: null });
    await run();
    const { rows } = await t.pool.query("select * from proposals");
    expect(JSON.stringify(rows)).not.toContain("Sold out");
  });
});
