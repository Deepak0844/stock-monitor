import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createMappingRepository, createProposalRepository, createShopifyRepository, createSupplierRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { createLogger } from "@stock-monitor/shared";
import { LOC_A, createFakeCatalog, createFakeShopify, makeVariant, type FakeShopify } from "@stock-monitor/shopify/testing";
import { createProposalsApplyHandler } from "../src/proposals-apply.js";

const CLIENT_ID = "CLIENT-ID-MARKER-7f3a";
const SECRET = "CLIENT-SECRET-MARKER-9c1e";
const SHOP = "my-store.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/4";
const ITEM = "gid://shopify/InventoryItem/4";
const NOW = new Date("2026-06-10T10:00:00Z");
const locations = [{ id: LOC_A, name: "Shop floor", isActive: true }];

let t: TestDb;
let fake: FakeShopify;
let catalog: ReturnType<typeof createFakeCatalog>;
let enqueued: { name: string; payload: unknown; options?: { startAfter?: number; retryLimit?: number } }[] = [];
let enqueueFails = false;
const key = { key: randomBytes(32), keyId: "v1" };
const logLines: string[] = [];
const logger = createLogger({ level: "info", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });

const proposals = () => createProposalRepository(t.appDb);
const shopify = () => createShopifyRepository(t.appDb, key);
const handler = () =>
  createProposalsApplyHandler({
    proposals: proposals(), shopify: shopify(), audit: createAuditWriter(t.appDb), logger, now: () => NOW,
    queue: { enqueue: async (name: string, payload: unknown, options?: never) => { if (enqueueFails) throw new Error("down"); enqueued.push({ name, payload, options }); } } as never,
    baseUrl: () => fake.url, clientOptions: { sleep: async () => {} },
  });

let supplier = "";
let mapping = "";
const connect = (scopes = ["read_products", "read_inventory", "write_inventory"], location: { id: string; name: string } | null = { id: LOC_A, name: "Shop floor" }) =>
  shopify().saveConnection({ shop: SHOP, credentials: { type: "client_credentials", clientId: CLIENT_ID, clientSecret: SECRET }, scopes, location });

/** An approved suggestion made from Shopify showing 4, asking for `quantity`. */
async function approved(quantity = 0, kind = "set_zero_out_of_stock") {
  const made = await proposals().evaluateFor({ variantId: VARIANT, mappingId: mapping, supplierId: supplier, observationId: null, shopifyQuantitySeen: 4, wanted: { kind, proposedQuantity: 0 }, expiresAt: new Date(NOW.getTime() + 86_400_000) });
  const p = await proposals().markApproved(made.proposal!.id, quantity, "owner", NOW);
  return p!;
}
const state = async (id: string) => (await proposals().get(id))!;
const stock = () => catalog.stockOf(ITEM, LOC_A);

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, shopify_connection, audit_events cascade");
  logLines.length = 0;
  enqueued = [];
  enqueueFails = false;
  fake = await createFakeShopify({ clientId: CLIENT_ID, clientSecret: SECRET });
  catalog = createFakeCatalog({ locations, variants: [makeVariant(4)] });
  fake.setGraphQL(catalog.handler);
  const s = await createSupplierRepository(t.appDb).create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  supplier = s.supplier.id;
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy, available)
     values ($1, 'p1', 'Tee', 'Large', '[]', 'S1', $2, true, 'DENY', 4)`,
    [VARIANT, ITEM],
  );
  const m = await createMappingRepository(t.appDb).create({ variantId: VARIANT, supplierId: supplier, url: "https://acme.example/a", note: null });
  if (!m.ok) throw new Error("setup");
  mapping = m.mapping.id;
  await connect();
});
afterEach(async () => {
  await fake.close();
});

describe("apply", () => {
  it("writes the approved number, records it, updates the synced number, and audits numbers only", async () => {
    const p = await approved(0);
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "applied", resultCode: "applied", resultQuantity: 0 });
    expect(stock()).toBe(0);
    expect(catalog.writes).toEqual([{ inventoryItemId: ITEM, locationId: LOC_A, quantity: 0, changeFromQuantity: 4, key: p.idempotencyKey }]);
    expect((await t.pool.query("select available from shopify_variants where variant_id = $1", [VARIANT])).rows[0].available).toBe(0);
    const audit = (await t.pool.query("select action, entity_id, details from audit_events where action like 'proposal.%'")).rows;
    expect(audit).toEqual([{ action: "proposal.applied", entity_id: p.id, details: { variantId: VARIANT, from: 4, to: 0 } }]);
    expect(enqueued).toEqual([]);
  });

  it("writes the edited number", async () => {
    const p = await approved(2);
    await handler()({ proposalId: p.id });
    expect(stock()).toBe(2);
    expect(await state(p.id)).toMatchObject({ state: "applied", approvedQuantity: 2, edited: true, resultQuantity: 2 });
  });

  it("a second run for the same suggestion writes nothing", async () => {
    const p = await approved();
    await handler()({ proposalId: p.id });
    await handler()({ proposalId: p.id });
    expect(catalog.writes).toHaveLength(1);
  });

  it("two runs at the same moment write once", async () => {
    const p = await approved();
    await Promise.all([handler()({ proposalId: p.id }), handler()({ proposalId: p.id })]);
    expect(catalog.writes).toHaveLength(1);
    expect(await state(p.id)).toMatchObject({ state: "applied" });
  });

  it("skips a suggestion that is not approved, without calling Shopify", async () => {
    const made = await proposals().evaluateFor({ variantId: VARIANT, mappingId: mapping, supplierId: supplier, observationId: null, shopifyQuantitySeen: 4, wanted: { kind: "set_zero_out_of_stock", proposedQuantity: 0 }, expiresAt: new Date(NOW.getTime() + 1000) });
    await handler()({ proposalId: made.proposal!.id });
    await proposals().reject(made.proposal!.id, null, "owner", NOW);
    await handler()({ proposalId: made.proposal!.id });
    await handler()({ proposalId: "11111111-1111-4111-8111-111111111111" });
    expect(fake.graphqlRequests()).toEqual([]);
    expect(stock()).toBe(4);
  });
});

describe("conflict", () => {
  it("Shopify changed since the suggestion: nothing is written, the suggestion is a conflict, and the newer number is kept", async () => {
    const p = await approved();
    catalog.setStock(ITEM, LOC_A, 3);
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "conflict", resultCode: "changed", resultQuantity: 3 });
    expect(stock()).toBe(3);
    expect(catalog.writes).toEqual([]);
    expect((await t.pool.query("select available from shopify_variants where variant_id = $1", [VARIANT])).rows[0].available).toBe(3);
    expect(enqueued).toEqual([]); // never retried by itself
  });

  it("the item is no longer stocked at the location: conflict", async () => {
    const p = await approved();
    catalog.setVariants([makeVariant(4, { stock: {} })]);
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "conflict", resultQuantity: null });
  });
});

describe("refusals", () => {
  it("without the write permission nothing is sent", async () => {
    await connect(["read_products", "read_inventory"]);
    const p = await approved();
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "failed", resultCode: "no_permission" });
    expect(fake.graphqlRequests()).toEqual([]);
  });

  it("Shopify says no access even though we thought we had it", async () => {
    catalog.setCanWrite(false);
    const p = await approved();
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "failed", resultCode: "no_permission" });
    expect(stock()).toBe(4);
  });

  it("Shopify refuses the change", async () => {
    catalog.failNextWrite("refuse");
    const p = await approved();
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "failed", resultCode: "refused" });
  });

  it("not connected, no location, or the variant is gone: failed with a fixed code", async () => {
    const a = await approved();
    await t.pool.query("delete from shopify_connection");
    await handler()({ proposalId: a.id });
    expect(await state(a.id)).toMatchObject({ state: "failed", resultCode: "not_connected" });

    await connect(undefined, null);
    const b = await approved();
    await handler()({ proposalId: b.id });
    expect(await state(b.id)).toMatchObject({ state: "failed", resultCode: "no_location" });

    await connect();
    const c = await approved();
    await t.pool.query("update shopify_variants set removed_at = now()");
    await handler()({ proposalId: c.id });
    expect(await state(c.id)).toMatchObject({ state: "failed", resultCode: "item_gone" });
  });
});

describe("unknown outcome", () => {
  it("stays approved, retries after 10 seconds with the same key, and then does not apply twice or call it a conflict", async () => {
    const p = await approved();
    catalog.failNextWrite("apply_then_fail");
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "approved", attempts: 1 });
    expect(enqueued).toEqual([{ name: "proposals.apply", payload: { proposalId: p.id }, options: { startAfter: 10, retryLimit: 0 } }]);
    expect(stock()).toBe(0); // Shopify did apply it

    catalog.recover();
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "applied", resultQuantity: 0 });
    expect(catalog.writes).toHaveLength(1);
    expect(catalog.writes[0]!.key).toBe(p.idempotencyKey);
  });

  it("retries after 10 seconds, 1 minute and 5 minutes, then stops and says it could not confirm", async () => {
    const p = await approved();
    catalog.failNextWrite("apply_then_fail");
    for (let i = 0; i < 4; i++) await handler()({ proposalId: p.id });
    expect(enqueued.map((e) => e.options?.startAfter)).toEqual([10, 60, 300]);
    expect(await state(p.id)).toMatchObject({ state: "failed", resultCode: "unconfirmed", attempts: 4 });
    expect(new Set(catalog.writes.map((w) => w.key)).size).toBe(1);
  });

  it("a queue that is down, or a worker killed after Shopify accepted, leaves it approved; running it again later applies it once and is not a conflict", async () => {
    const p = await approved();
    catalog.failNextWrite("apply_then_fail");
    enqueueFails = true;
    await expect(handler()({ proposalId: p.id })).resolves.toBeUndefined();
    expect(await state(p.id)).toMatchObject({ state: "approved" });
    catalog.recover();
    await handler()({ proposalId: p.id });
    expect(await state(p.id)).toMatchObject({ state: "applied" });
    expect(catalog.writes).toHaveLength(1);
  });
});

describe("no secrets", () => {
  it("no log line holds the key, credentials or a token", async () => {
    const p = await approved();
    await handler()({ proposalId: p.id });
    const text = logLines.join("") + JSON.stringify((await t.pool.query("select * from audit_events")).rows);
    for (const secret of [SECRET, CLIENT_ID, p.idempotencyKey!, "fake-access-token"]) expect(text).not.toContain(secret);
  });
});
