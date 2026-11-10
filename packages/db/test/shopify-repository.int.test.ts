import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { CatalogVariant } from "@stock-monitor/shopify";
import { startTestDb, type TestDb } from "./harness.js";
import { createShopifyRepository } from "../src/shopify-repository.js";

let t: TestDb;
const key = { key: randomBytes(32), keyId: "v1" };
// The repository runs as the restricted app role, exactly like the API and worker.
const repo = () => createShopifyRepository(t.appDb, key);

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

const CLIENT_ID = "CLIENT-ID-PLAINTEXT-MARKER";
const SECRET = "CLIENT-SECRET-PLAINTEXT-MARKER";
const TOKEN = "STATIC-TOKEN-PLAINTEXT-MARKER";
const creds = { type: "client_credentials" as const, clientId: CLIENT_ID, clientSecret: SECRET };

const variant = (n: number, over: Partial<CatalogVariant> = {}): CatalogVariant => ({
  variantId: `gid://shopify/ProductVariant/${n}`,
  productId: `gid://shopify/Product/${Math.ceil(n / 3)}`,
  productTitle: `Product ${Math.ceil(n / 3)}`,
  variantTitle: `Size ${n}`,
  options: [{ name: "Size", value: String(n) }, { name: "Colour", value: "Blue" }],
  sku: `SKU-${n}`,
  inventoryItemId: `gid://shopify/InventoryItem/${n}`,
  tracked: true,
  inventoryPolicy: "DENY",
  available: n,
  ...over,
});

const reset = async () => {
  await t.pool.query("truncate shopify_connection, shopify_variants, shopify_sync_runs cascade");
};

describe("connection: one row, credentials encrypted", () => {
  it("saves and reads a connection without any secret in the readable record", async () => {
    await reset();
    await repo().saveConnection({ shop: "my-store.myshopify.com", credentials: creds, scopes: ["read_products", "read_inventory"] });
    const connection = await repo().getConnection();
    expect(connection).toMatchObject({
      shop: "my-store.myshopify.com",
      credentialType: "client_credentials",
      scopes: ["read_products", "read_inventory"],
      locationId: null,
      locationName: null,
      status: "connected",
      lastSuccessfulCallAt: null,
    });
    expect(connection!.connectedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(connection)).not.toContain(SECRET);
    expect(JSON.stringify(connection)).not.toContain(CLIENT_ID);
    // An exact list of fields: nothing else, in particular no ciphertext, iv, tag or key id, can slip in.
    expect(Object.keys(connection!).sort()).toEqual(
      ["connectedAt", "credentialType", "lastSuccessfulCallAt", "locationId", "locationName", "scopes", "shop", "status"],
    );
  });

  it("stores no plaintext client id, secret or token in the table", async () => {
    await reset();
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: creds, scopes: [] });
    const raw = await t.pool.query("select * from shopify_connection");
    const text = JSON.stringify(raw.rows);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(CLIENT_ID);
    expect(raw.rows[0].credentials_key_id).toBe("v1");
    expect(raw.rows[0].credentials_ciphertext).toBeTruthy();

    await repo().saveConnection({ shop: "a.myshopify.com", credentials: { type: "static_token", accessToken: TOKEN }, scopes: [] });
    const raw2 = await t.pool.query("select * from shopify_connection");
    expect(JSON.stringify(raw2.rows)).not.toContain(TOKEN);
  });

  it("gives the credentials back, for server use only", async () => {
    await reset();
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: creds, scopes: [] });
    expect(await repo().getCredentials()).toEqual({ shop: "a.myshopify.com", credentials: creds });
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: { type: "static_token", accessToken: TOKEN }, scopes: [] });
    expect((await repo().getCredentials())!.credentials).toEqual({ type: "static_token", accessToken: TOKEN });
  });

  it("returns nothing when there is no connection", async () => {
    await reset();
    expect(await repo().getConnection()).toBeNull();
    expect(await repo().getCredentials()).toBeNull();
  });

  it("never holds more than one connection: saving again replaces it", async () => {
    await reset();
    await repo().saveConnection({ shop: "first.myshopify.com", credentials: creds, scopes: ["read_products"], location: { id: "gid://shopify/Location/1", name: "Old" } });
    await repo().saveConnection({ shop: "second.myshopify.com", credentials: creds, scopes: ["read_inventory"] });
    const { rows } = await t.pool.query("select shop, location_id from shopify_connection");
    expect(rows).toEqual([{ shop: "second.myshopify.com", location_id: null }]);
  });

  it("refuses a second row at the database level", async () => {
    await reset();
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: creds, scopes: [] });
    await expect(
      t.appPool.query(
        `insert into shopify_connection (id, shop, credential_type, credentials_ciphertext, credentials_iv, credentials_tag, credentials_key_id)
         values (false, 'b.myshopify.com', 'static_token', 'c', 'i', 't', 'v1')`,
      ),
    ).rejects.toThrow(/check|violates/i);
  });

  it("refuses an unknown status or credential type at the database level", async () => {
    await reset();
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: creds, scopes: [] });
    await expect(t.appPool.query("update shopify_connection set status = 'broken'")).rejects.toThrow(/check|violates/i);
    await expect(t.appPool.query("update shopify_connection set credential_type = 'magic'")).rejects.toThrow(/check|violates/i);
  });

  it("remembers the chosen location, the status and the last successful call", async () => {
    await reset();
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: creds, scopes: [] });
    await repo().setLocation({ id: "gid://shopify/Location/7", name: "Shop floor" });
    await repo().setStatus("needs_reconnect");
    let c = await repo().getConnection();
    expect(c).toMatchObject({ locationId: "gid://shopify/Location/7", locationName: "Shop floor", status: "needs_reconnect" });
    await repo().setStatus("connected");
    await repo().touchSuccess();
    c = await repo().getConnection();
    expect(c!.status).toBe("connected");
    expect(c!.lastSuccessfulCallAt).toBeInstanceOf(Date);
  });

  it("can be disconnected", async () => {
    await reset();
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: creds, scopes: [] });
    await repo().deleteConnection();
    expect(await repo().getConnection()).toBeNull();
  });

  it("cannot read credentials with a different key, or if they were tampered with", async () => {
    await reset();
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: creds, scopes: [] });
    const other = createShopifyRepository(t.appDb, { key: randomBytes(32), keyId: "v1" });
    await expect(other.getCredentials()).rejects.toThrow();
    await t.pool.query("update shopify_connection set credentials_tag = credentials_iv");
    await expect(repo().getCredentials()).rejects.toThrow();
  });

  it("refuses credentials saved under a key id it does not have", async () => {
    await reset();
    await repo().saveConnection({ shop: "a.myshopify.com", credentials: creds, scopes: [] });
    await t.pool.query("update shopify_connection set credentials_key_id = 'old-key'");
    await expect(repo().getCredentials()).rejects.toThrow(/key/i);
  });
});

describe("variants: repeatable saves", () => {
  it("saves variants and reads them back exactly, including null SKU and a null versus zero quantity", async () => {
    await reset();
    const input = [variant(1), variant(2, { sku: null, available: null, tracked: false, inventoryPolicy: "CONTINUE" }), variant(3, { available: 0 })];
    await repo().catalogStore().save(input);
    const all = await repo().catalogStore().getAll();
    const byId = new Map(all.map((v) => [v.variantId, v]));
    for (const v of input) expect(byId.get(v.variantId)).toEqual({ ...v, removed: false });
    expect(byId.get(input[1]!.variantId)!.available).toBeNull();
    expect(byId.get(input[2]!.variantId)!.available).toBe(0);
  });

  it("keeps the order of option values", async () => {
    await reset();
    await repo().catalogStore().save([variant(1, { options: [{ name: "Z", value: "last" }, { name: "A", value: "first" }] })]);
    expect((await repo().catalogStore().getAll())[0]!.options.map((o) => o.name)).toEqual(["Z", "A"]);
  });

  it("changes nothing when the same variants are saved twice", async () => {
    await reset();
    const store = repo().catalogStore();
    await store.save([variant(1), variant(2)]);
    await store.save([variant(1), variant(2)]);
    const { rows } = await t.pool.query("select count(*)::int as n from shopify_variants");
    expect(rows[0].n).toBe(2);
    expect((await store.getAll()).map((v) => v.available).sort()).toEqual([1, 2]);
  });

  it("updates a variant that changed", async () => {
    await reset();
    const store = repo().catalogStore();
    await store.save([variant(1)]);
    await store.save([variant(1, { variantTitle: "Renamed", available: 42 })]);
    const [v] = await store.getAll();
    expect(v).toMatchObject({ variantTitle: "Renamed", available: 42 });
  });

  it("saves a large catalog in batches", async () => {
    await reset();
    const many = Array.from({ length: 1300 }, (_, i) => variant(i + 1));
    await repo().catalogStore().save(many);
    expect((await repo().catalogStore().getAll()).length).toBe(1300);
  });

  it("does nothing for an empty save", async () => {
    await reset();
    await expect(repo().catalogStore().save([])).resolves.toBeUndefined();
  });
});

describe("variants: removed, never deleted", () => {
  it("marks variants removed and keeps the rows", async () => {
    await reset();
    const store = repo().catalogStore();
    await store.save([variant(1), variant(2)]);
    await store.markRemoved([variant(2).variantId]);
    const all = await store.getAll();
    expect(all).toHaveLength(2);
    expect(all.find((v) => v.variantId === variant(2).variantId)!.removed).toBe(true);
    expect(all.find((v) => v.variantId === variant(1).variantId)!.removed).toBe(false);
  });

  it("brings a removed variant back when it is saved again", async () => {
    await reset();
    const store = repo().catalogStore();
    await store.save([variant(1)]);
    await store.markRemoved([variant(1).variantId]);
    await store.save([variant(1)]);
    expect((await store.getAll())[0]!.removed).toBe(false);
  });

  it("keeps the original removal time if a removed variant is marked again", async () => {
    await reset();
    const store = repo().catalogStore();
    await store.save([variant(1)]);
    await store.markRemoved([variant(1).variantId]);
    const first = (await t.pool.query("select removed_at from shopify_variants")).rows[0].removed_at;
    await store.markRemoved([variant(1).variantId]);
    const second = (await t.pool.query("select removed_at from shopify_variants")).rows[0].removed_at;
    expect(second).toEqual(first);
  });

  it("ignores an empty list and ids it does not know", async () => {
    await reset();
    const store = repo().catalogStore();
    await store.save([variant(1)]);
    await store.markRemoved([]);
    await store.markRemoved(["gid://shopify/ProductVariant/999"]);
    expect((await store.getAll())[0]!.removed).toBe(false);
  });
});

describe("listing variants", () => {
  const seed = async () => {
    await reset();
    await repo().catalogStore().save([
      variant(1, { productTitle: "Garden Gloves", variantTitle: "Small", sku: "GLV-S", available: 4 }),
      variant(2, { productTitle: "Garden Gloves", variantTitle: "Large", sku: "GLV-L", available: 0, tracked: false }),
      variant(3, { productTitle: "Hose Reel", variantTitle: "30m", sku: "HOSE-30", available: null, inventoryPolicy: "CONTINUE" }),
      variant(4, { productTitle: "50% Off Sign", variantTitle: "A_B", sku: null }),
      variant(5, { productTitle: "Old Item", variantTitle: "Gone", sku: "OLD-1" }),
    ]);
    await repo().catalogStore().markRemoved([variant(5).variantId]);
  };

  it("lists variants in a stable order, without removed ones, with the total", async () => {
    await seed();
    const page = await repo().listVariants({ page: 1, pageSize: 25 });
    expect(page.total).toBe(4);
    expect(page.items.map((v) => v.variantTitle)).toEqual(["A_B", "Large", "Small", "30m"]);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
  });

  it("pages through the results", async () => {
    await seed();
    const first = await repo().listVariants({ page: 1, pageSize: 3 });
    const second = await repo().listVariants({ page: 2, pageSize: 3 });
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
    expect(first.total).toBe(4);
    expect(new Set([...first.items, ...second.items].map((v) => v.variantId)).size).toBe(4);
  });

  it("searches product title, variant title and SKU, ignoring capitals", async () => {
    await seed();
    expect((await repo().listVariants({ page: 1, pageSize: 25, search: "garden" })).total).toBe(2);
    expect((await repo().listVariants({ page: 1, pageSize: 25, search: "LARGE" })).items.map((v) => v.sku)).toEqual(["GLV-L"]);
    expect((await repo().listVariants({ page: 1, pageSize: 25, search: "hose-30" })).total).toBe(1);
  });

  it("treats % and _ in a search as ordinary characters", async () => {
    await seed();
    expect((await repo().listVariants({ page: 1, pageSize: 25, search: "50%" })).total).toBe(1);
    expect((await repo().listVariants({ page: 1, pageSize: 25, search: "%" })).total).toBe(1);
    expect((await repo().listVariants({ page: 1, pageSize: 25, search: "A_B" })).total).toBe(1);
    expect((await repo().listVariants({ page: 1, pageSize: 25, search: "_" })).total).toBe(1);
  });

  it("can show only variants that need attention", async () => {
    await seed();
    const page = await repo().listVariants({ page: 1, pageSize: 25, warningsOnly: true });
    expect(page.items.map((v) => v.variantTitle).sort()).toEqual(["30m", "Large"]);
  });

  it("returns an empty page past the end", async () => {
    await seed();
    expect(await repo().listVariants({ page: 9, pageSize: 25 })).toMatchObject({ items: [], total: 4 });
  });
});

describe("sync runs", () => {
  it("records a successful run with its counts", async () => {
    await reset();
    const id = await repo().startSyncRun();
    expect(id).not.toBeNull();
    await repo().finishSyncRun(id!, { status: "succeeded", result: { added: 3, updated: 2, unchanged: 5, removed: 1, total: 10 } });
    expect(await repo().lastSyncRun()).toMatchObject({ status: "succeeded", added: 3, updated: 2, unchanged: 5, removed: 1, total: 10, error: null });
    expect((await repo().lastSyncRun())!.finishedAt).toBeInstanceOf(Date);
  });

  it("records a failed run with a plain-English message", async () => {
    await reset();
    const id = await repo().startSyncRun();
    await repo().finishSyncRun(id!, { status: "failed", error: "Can't reach Shopify right now. Try again in a few minutes." });
    expect(await repo().lastSyncRun()).toMatchObject({ status: "failed", error: "Can't reach Shopify right now. Try again in a few minutes." });
  });

  it("will not start a second run while one is running", async () => {
    await reset();
    expect(await repo().startSyncRun()).not.toBeNull();
    expect(await repo().startSyncRun()).toBeNull();
  });

  it("lets a new run start once the last one has finished", async () => {
    await reset();
    const id = await repo().startSyncRun();
    await repo().finishSyncRun(id!, { status: "succeeded", result: { added: 0, updated: 0, unchanged: 0, removed: 0, total: 0 } });
    expect(await repo().startSyncRun()).not.toBeNull();
  });

  it("closes a run that was left running for over 30 minutes as interrupted, and starts a new one", async () => {
    await reset();
    await repo().startSyncRun();
    await t.pool.query("update shopify_sync_runs set started_at = now() - interval '2 hours'");
    expect(await repo().startSyncRun()).not.toBeNull();
    const { rows } = await t.pool.query("select status, error from shopify_sync_runs order by id");
    expect(rows[0]).toMatchObject({ status: "failed" });
    expect(rows[0].error).toMatch(/interrupted/i);
  });

  it("knows whether a sync is running, and ignores one that was left running for over 30 minutes", async () => {
    await reset();
    expect(await repo().isSyncRunning()).toBe(false);
    await repo().startSyncRun();
    expect(await repo().isSyncRunning()).toBe(true);
    await t.pool.query("update shopify_sync_runs set started_at = now() - interval '2 hours'");
    expect(await repo().isSyncRunning()).toBe(false);
  });

  it("records progress on a running sync, and the final result replaces it", async () => {
    await reset();
    const id = await repo().startSyncRun();
    await repo().updateSyncProgress(id!, 50);
    expect(await repo().lastSyncRun()).toMatchObject({ status: "running", total: 50 });
    await repo().updateSyncProgress(id!, 120);
    expect((await repo().lastSyncRun())!.total).toBe(120);
    await repo().finishSyncRun(id!, { status: "succeeded", result: { added: 120, updated: 0, unchanged: 0, removed: 0, total: 120 } });
    expect(await repo().lastSyncRun()).toMatchObject({ status: "succeeded", total: 120 });
  });

  it("ignores progress for a run that has already finished", async () => {
    await reset();
    const id = await repo().startSyncRun();
    await repo().finishSyncRun(id!, { status: "failed", error: "x" });
    await repo().updateSyncProgress(id!, 999);
    expect((await repo().lastSyncRun())!.total).toBeNull();
  });

  it("returns the newest run, or nothing", async () => {
    await reset();
    expect(await repo().lastSyncRun()).toBeNull();
    const a = await repo().startSyncRun();
    await repo().finishSyncRun(a!, { status: "failed", error: "first" });
    const b = await repo().startSyncRun();
    await repo().finishSyncRun(b!, { status: "succeeded", result: { added: 1, updated: 0, unchanged: 0, removed: 0, total: 1 } });
    expect((await repo().lastSyncRun())!.status).toBe("succeeded");
  });

  it("keeps a very long error message short", async () => {
    await reset();
    const id = await repo().startSyncRun();
    await repo().finishSyncRun(id!, { status: "failed", error: "x".repeat(5000) });
    expect((await repo().lastSyncRun())!.error!.length).toBeLessThanOrEqual(500);
  });
});

describe("the app role", () => {
  it("can use the new tables but not change the audit log", async () => {
    await expect(t.appPool.query("select count(*) from shopify_variants")).resolves.toBeDefined();
    await expect(t.appPool.query("delete from audit_events")).rejects.toThrow(/permission denied/i);
  });
});
