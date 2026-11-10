import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createMappingRepository } from "../src/mapping-repository.js";
import { createImportPreviewRepository } from "../src/import-preview-repository.js";
import { createSupplierRepository } from "../src/supplier-repository.js";

let t: TestDb;
const maps = () => createMappingRepository(t.appDb);
const previews = () => createImportPreviewRepository(t.appDb);
const suppliers = () => createSupplierRepository(t.appDb);
let acme = "";
let globex = "";

const addVariant = (id: string, sku: string | null, removed = false, shopify: { name: string | null; url: string | null } = { name: null, url: null }) =>
  t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy, removed_at, supplier_name, supplier_url)
     values ($1, 'p1', 'Tee', $2, '[]', $3, $4, true, 'DENY', ${removed ? "now()" : "null"}, $5, $6)`,
    [id, `Variant ${id}`, sku, `inv-${id}`, shopify.name, shopify.url],
  );

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, import_previews cascade");
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  const g = await suppliers().create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!a.ok || !g.ok) throw new Error("setup");
  acme = a.supplier.id;
  globex = g.supplier.id;
  await addVariant("v1", "S1");
  await addVariant("v2", "S2");
  await addVariant("v3", "S3");
  await addVariant("gone", "S4", true);
});

describe("mappings", () => {
  it("creates a link that starts not checked, and refuses a second for the same variant and supplier", async () => {
    const first = await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/a", note: null });
    expect(first).toMatchObject({ ok: true, mapping: { linkStatus: "not_checked", missingChecks: 0, enabled: true } });
    expect(await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/b", note: null })).toEqual({ ok: false, reason: "duplicate" });
  });

  it("says plainly when the variant or the supplier does not exist", async () => {
    expect(await maps().create({ variantId: "nope", supplierId: acme, url: "https://acme.example/a", note: null })).toEqual({ ok: false, reason: "unknown_variant" });
    expect(await maps().create({ variantId: "v1", supplierId: "11111111-1111-4111-8111-111111111111", url: "https://acme.example/a", note: null })).toEqual({ ok: false, reason: "unknown_supplier" });
  });

  it("lists links with product, variant and supplier names, and filters by supplier, status and search", async () => {
    await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/a", note: null });
    await maps().create({ variantId: "v2", supplierId: globex, url: "https://globex.example/b", note: null });
    expect(await maps().list({})).toHaveLength(2);
    expect(await maps().list({ supplierId: globex })).toMatchObject([{ variantId: "v2", supplierName: "Globex", productTitle: "Tee", sku: "S2" }]);
    expect(await maps().list({ linkStatus: "works" })).toHaveLength(0);
    expect(await maps().list({ search: "s1" })).toMatchObject([{ variantId: "v1" }]);
  });

  it("resets the link history when the address changes, but not when only the note does", async () => {
    const created = await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/a", note: null });
    if (!created.ok) throw new Error("setup");
    const id = created.mapping.id;
    const checked = new Date("2026-11-01T10:00:00Z");
    await maps().recordCheck(id, { status: "works", lastWorkedAt: checked, workedTitle: "Tee", workedHeading: "Tee", missingChecks: 0, firstMissingAt: null, checkedAt: checked });
    await maps().update(id, { note: "hello" });
    expect(await maps().get(id)).toMatchObject({ linkStatus: "works", workedTitle: "Tee", note: "hello" });
    await maps().update(id, { url: "https://acme.example/new" });
    expect(await maps().get(id)).toMatchObject({ url: "https://acme.example/new", linkStatus: "not_checked", workedTitle: null, lastWorkedAt: null, missingChecks: 0 });
  });

  it("saves what a check found", async () => {
    const created = await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/a", note: null });
    if (!created.ok) throw new Error("setup");
    const worked = new Date("2026-11-01T10:00:00Z");
    const missing = new Date("2026-11-02T10:00:00Z");
    await maps().recordCheck(created.mapping.id, { status: "page_missing", lastWorkedAt: worked, workedTitle: "Tee", workedHeading: null, missingChecks: 1, firstMissingAt: missing, checkedAt: missing });
    expect(await maps().get(created.mapping.id)).toMatchObject({ linkStatus: "page_missing", missingChecks: 1, lastWorkedAt: worked, firstMissingAt: missing, lastLinkCheckAt: missing });
  });

  it("deletes a supplier's links with the supplier", async () => {
    await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/a", note: null });
    await suppliers().remove(acme);
    expect(await maps().list({})).toHaveLength(0);
  });

  it("keeps a link when Shopify removes its variant, and labels it", async () => {
    await addVariant("v9", "S9");
    await maps().create({ variantId: "v9", supplierId: acme, url: "https://acme.example/z", note: null });
    await t.pool.query("update shopify_variants set removed_at = now() where variant_id = 'v9'");
    expect(await maps().list({})).toMatchObject([{ variantId: "v9", variantRemoved: true }]);
  });

  it("refuses to delete a variant that has a link", async () => {
    await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/a", note: null });
    await expect(t.pool.query("delete from shopify_variants where variant_id = 'v1'")).rejects.toThrow();
  });
});

describe("upsertMany", () => {
  it("creates, then leaves one link per variant when the same rows come again", async () => {
    const rows = [
      { variantId: "v1", supplierId: acme, url: "https://acme.example/a" },
      { variantId: "v2", supplierId: acme, url: "https://acme.example/b" },
    ];
    expect(await maps().upsertMany(rows)).toEqual({ created: 2, updated: 0, unchanged: 0 });
    expect(await maps().upsertMany(rows)).toEqual({ created: 0, updated: 0, unchanged: 2 });
    expect(await maps().list({})).toHaveLength(2);
  });

  it("replaces a changed address and resets its history", async () => {
    await maps().upsertMany([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a" }]);
    const [m] = await maps().list({});
    await maps().recordCheck(m!.id, { status: "works", lastWorkedAt: new Date(), workedTitle: "T", workedHeading: null, missingChecks: 0, firstMissingAt: null, checkedAt: new Date() });
    expect(await maps().upsertMany([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a2" }])).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(await maps().list({})).toMatchObject([{ url: "https://acme.example/a2", linkStatus: "not_checked", workedTitle: null }]);
  });

  it("gives the existing links by variant, for the import preview", async () => {
    await maps().upsertMany([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a" }]);
    expect(await maps().linksByVariant()).toEqual([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a" }]);
  });
});

describe("unmapped variants", () => {
  it("counts and lists variants with no link, leaving removed variants out", async () => {
    await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/a", note: null });
    const r = await maps().unmappedVariants({});
    expect(r.total).toBe(3);
    expect(r.unmapped).toBe(2);
    expect(r.items.map((i) => i.variantId).sort()).toEqual(["v2", "v3"]);
    expect((await maps().unmappedVariants({ search: "s3" })).items.map((i) => i.variantId)).toEqual(["v3"]);
  });
});

describe("supplier permission", () => {
  it("starts unknown, with a pause of 10 seconds, and records the owner's decision", async () => {
    expect(await suppliers().get(acme)).toMatchObject({ automationPermission: "unknown", permissionNote: null, permissionSetAt: null, checkPauseSeconds: 10 });
    await suppliers().setPermission(acme, { status: "granted", note: "Emailed 10 Nov" });
    expect(await suppliers().get(acme)).toMatchObject({ automationPermission: "granted", permissionNote: "Emailed 10 Nov" });
    expect((await suppliers().get(acme))?.permissionSetAt).toBeInstanceOf(Date);
  });
});

describe("import previews", () => {
  it("hands the stored rows back once, then forgets them", async () => {
    const id = await previews().save([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a" }]);
    expect(await previews().take(id)).toEqual([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a" }]);
    expect(await previews().take(id)).toBeNull();
  });
  it("forgets previews older than an hour", async () => {
    const id = await previews().save([]);
    await t.pool.query("update import_previews set created_at = now() - interval '61 minutes'");
    await previews().purgeOlderThan(60);
    expect(await previews().take(id)).toBeNull();
  });
  it("treats a made-up id as not found", async () => {
    expect(await previews().take("not-an-id")).toBeNull();
  });
});

describe("links that come from Shopify's metafields", () => {
  const both = { name: "Acme", url: "https://acme.example/p/1" };

  it("lists only live variants that have both a supplier name and a page address", async () => {
    await addVariant("s-both", "SB", false, both);
    await addVariant("s-name", "SN", false, { name: "Acme", url: null });
    await addVariant("s-url", "SU", false, { name: null, url: "https://acme.example/p/2" });
    await addVariant("s-gone", "SG", true, both);
    const found = await maps().shopifyLinkSources();
    expect(found.map((v) => v.variantId)).toEqual(["s-both"]);
    expect(found[0]).toMatchObject({ productTitle: "Tee", sku: "SB", supplierName: "Acme", supplierUrl: "https://acme.example/p/1" });
  });

  it("creates a link, leaves an identical one alone, and replaces a different one, starting its history again", async () => {
    const created = await maps().upsertFromShopify([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a" }]);
    expect(created).toEqual({ created: 1, updated: 0, unchanged: 0 });
    expect(await maps().upsertFromShopify([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a" }])).toEqual({ created: 0, updated: 0, unchanged: 1 });

    const [link] = await maps().list({});
    await maps().recordCheck(link!.id, { status: "works", lastWorkedAt: new Date(), workedTitle: "T", workedHeading: "H", missingChecks: 0, firstMissingAt: null, checkedAt: new Date() });
    expect(await maps().upsertFromShopify([{ variantId: "v1", supplierId: acme, url: "https://acme.example/b" }])).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect((await maps().list({}))[0]).toMatchObject({ url: "https://acme.example/b", linkStatus: "not_checked", lastWorkedAt: null });
  });

  it("moves a link to another supplier when Shopify says so (Shopify is the one source)", async () => {
    await maps().create({ variantId: "v1", supplierId: globex, url: "https://globex.example/a", note: "mine" });
    expect(await maps().upsertFromShopify([{ variantId: "v1", supplierId: acme, url: "https://acme.example/a" }])).toEqual({ created: 0, updated: 1, unchanged: 0 });
    const links = await maps().list({});
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ supplierId: acme, url: "https://acme.example/a" });
  });

  it("marks a link as managed by Shopify when its variant has both fields, and not otherwise", async () => {
    await addVariant("s-both", "SB", false, both);
    await maps().create({ variantId: "s-both", supplierId: acme, url: "https://acme.example/p/1", note: null });
    await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/a", note: null });
    const byVariant = new Map((await maps().list({})).map((m) => [m.variantId, m.shopifyManaged]));
    expect(byVariant.get("s-both")).toBe(true);
    expect(byVariant.get("v1")).toBe(false);
  });
});
