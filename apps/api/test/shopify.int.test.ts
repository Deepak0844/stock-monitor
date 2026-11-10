import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createShopifyRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import type { CatalogVariant } from "@stock-monitor/shopify";
import {
  LOC_A,
  LOC_B,
  createFakeCatalog,
  createFakeShopify,
  makeVariant,
  withFakeShop,
  type FakeShopify,
} from "@stock-monitor/shopify/testing";
import { buildApp } from "../src/app.js";

const SHOP = "my-store.myshopify.com";
const CLIENT_ID = "CLIENT-ID-MARKER-41d2";
const SECRET = "CLIENT-SECRET-MARKER-8b7f";
const STATIC_TOKEN = "STATIC-TOKEN-MARKER-5e90";
const locations = [
  { id: LOC_A, name: "Shop floor", isActive: true },
  { id: LOC_B, name: "Back room", isActive: true },
  { id: "gid://shopify/Location/3", name: "Closed depot", isActive: false },
];

let t: TestDb;
let fake: FakeShopify;
let sid: string;
const key = { key: randomBytes(32), keyId: "v1" };
const queued: { name: string; payload: unknown }[] = [];
const logLines: string[] = [];
const bodies: string[] = [];

const repo = () => createShopifyRepository(t.appDb, key);
const logger = createLogger({
  level: "info",
  stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }),
});

function app() {
  return buildApp({
    db: t.appDb,
    logger,
    shopify: {
      repo: repo(),
      queue: { enqueue: async (name, payload) => void queued.push({ name, payload }) },
      baseUrl: () => fake.url,
      clientOptions: { sleep: async () => {} },
    },
  });
}

// Reads a value from a response body by path, for example at(body, "error.code"), without any.
const at = (value: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((v, key) => (v as Record<string, unknown> | undefined)?.[key], value);
type Item = { variantId: string; sku: string | null; available: number | null; warnings: unknown[] };
type Method = "GET" | "POST" | "PUT" | "DELETE";
async function call(a: ReturnType<typeof app>, method: Method, url: string, payload?: unknown, cookie = true) {
  const res = await a.inject({ method, url, payload: payload as never, cookies: cookie ? { sid } : {} });
  bodies.push(res.body);
  return { status: res.statusCode, body: res.json() as unknown };
}

const connectBody = { shop: SHOP, clientId: CLIENT_ID, clientSecret: SECRET };

const catalog = () => createFakeCatalog({ locations, variants: [makeVariant(1), makeVariant(2)] });
const serve = (opts: Parameters<typeof withFakeShop>[1] = {}) => fake.setGraphQL(withFakeShop(catalog().handler, opts));

beforeAll(async () => {
  t = await startTestDb();
  const user = await t.pool.query("insert into users (email, password_hash) values ('owner@example.com', 'h') returning id");
  const token = randomBytes(32).toString("hex");
  await t.pool.query("insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [
    user.rows[0].id,
    createHash("sha256").update(token).digest("hex"),
  ]);
  sid = token;
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

const fresh = async () => {
  await t.pool.query("truncate shopify_connection, shopify_variants, shopify_sync_runs, audit_events cascade");
  queued.length = 0;
  logLines.length = 0;
  bodies.length = 0;
  fake = await createFakeShopify({ clientId: CLIENT_ID, clientSecret: SECRET });
  fake.allowToken(STATIC_TOKEN);
  serve();
};
afterEach(async () => {
  await fake?.close();
});

const audit = async (action: string) =>
  (await t.pool.query("select actor_user_id, details from audit_events where action = $1", [action])).rows;

describe("every Shopify route needs a signed-in owner", () => {
  it.each([
    ["GET", "/api/shopify/connection"],
    ["POST", "/api/shopify/connection"],
    ["DELETE", "/api/shopify/connection"],
    ["POST", "/api/shopify/test"],
    ["GET", "/api/shopify/locations"],
    ["PUT", "/api/shopify/location"],
    ["POST", "/api/shopify/sync"],
    ["GET", "/api/shopify/sync"],
    ["GET", "/api/shopify/variants"],
  ] as const)("%s %s returns 401 without a session", async (method, url) => {
    await fresh();
    const res = await call(app(), method, url, method === "GET" || method === "DELETE" ? undefined : {}, false);
    expect(res.status).toBe(401);
    expect(fake.requests).toHaveLength(0);
  });
});

describe("POST /api/shopify/test", () => {
  it("shows the shop's name and permissions for good credentials, and saves nothing", async () => {
    await fresh();
    const res = await call(app(), "POST", "/api/shopify/test", connectBody);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ shopName: "Fake Store", scopes: ["read_products", "read_inventory"], writeScopes: [], missingScopes: [], warnings: [] });
    expect(await repo().getConnection()).toBeNull();
  });

  it("warns in plain words when the connection can change the store", async () => {
    await fresh();
    serve({ scopes: ["read_products", "read_inventory", "write_inventory"] });
    const res = await call(app(), "POST", "/api/shopify/test", connectBody);
    expect(at(res.body, "writeScopes")).toEqual(["write_inventory"]);
    expect(at(res.body, "warnings.0")).toMatch(/can change stock numbers/);
  });

  it("names a missing read permission", async () => {
    await fresh();
    serve({ scopes: ["read_products"] });
    const res = await call(app(), "POST", "/api/shopify/test", connectBody);
    expect(at(res.body, "missingScopes")).toEqual(["read_inventory"]);
    expect(at(res.body, "warnings.0")).toMatch(/missing permission to read inventory/);
  });

  it("says so when the permissions cannot be checked", async () => {
    await fresh();
    serve({ scopesDenied: true });
    const res = await call(app(), "POST", "/api/shopify/test", connectBody);
    expect(res.status).toBe(200);
    expect(at(res.body, "scopes")).toBeNull();
    expect(at(res.body, "warnings")).toEqual(["We could not check which permissions this connection has."]);
  });

  it("tells the owner when the credentials are wrong", async () => {
    await fresh();
    const res = await call(app(), "POST", "/api/shopify/test", { ...connectBody, clientSecret: "wrong" });
    expect(res.status).toBe(422);
    expect(at(res.body, "error")).toMatchObject({ code: "shopify_rejected_credentials", message: "Shopify rejected the saved connection. Reconnect Shopify." });
  });

  it("refuses a bad store address before contacting anyone", async () => {
    await fresh();
    for (const shop of ["evil.com", "x.myshopify.com.evil.com", "https://x.myshopify.com", ""]) {
      const res = await call(app(), "POST", "/api/shopify/test", { ...connectBody, shop });
      expect(res.status).toBe(400);
      expect(at(res.body, "error")).toMatchObject({ code: expect.stringMatching(/invalid_shop|invalid_input/) });
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses a body that is not the right shape", async () => {
    await fresh();
    for (const body of [{}, { shop: SHOP }, { shop: SHOP, clientId: CLIENT_ID }, { ...connectBody, extra: 1 }, { shop: SHOP, clientId: 5, clientSecret: 6 }]) {
      expect((await call(app(), "POST", "/api/shopify/test", body)).status).toBe(400);
    }
  });

  it("tests the saved connection when no details are sent", async () => {
    await fresh();
    expect(at((await call(app(), "POST", "/api/shopify/test")).body, "error.code")).toBe("not_connected");
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    const res = await call(app(), "POST", "/api/shopify/test");
    expect(res.status).toBe(200);
    expect(at(res.body, "shopName")).toBe("Fake Store");
  });

  it("accepts a legacy permanent token", async () => {
    await fresh();
    const res = await call(app(), "POST", "/api/shopify/test", { shop: SHOP, accessToken: STATIC_TOKEN });
    expect(res.status).toBe(200);
  });

  it("writes an audit event without any secret", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/test", connectBody);
    const rows = await audit("shopify.connection_tested");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`${SECRET}|${CLIENT_ID}`));
  });
});

describe("POST /api/shopify/connection", () => {
  it("saves the connection and returns it without any secret", async () => {
    await fresh();
    const res = await call(app(), "POST", "/api/shopify/connection", connectBody);
    expect(res.status).toBe(200);
    expect(Object.keys(at(res.body, "connection") as object).sort()).toEqual(
      ["connectedAt", "credentialType", "lastSuccessfulCallAt", "locationId", "locationName", "scopes", "shop", "status"],
    );
    expect(at(res.body, "connection")).toMatchObject({ shop: SHOP, credentialType: "client_credentials", scopes: ["read_products", "read_inventory"], status: "connected" });
    expect(at(res.body, "shopName")).toBe("Fake Store");
    expect((await repo().getCredentials())!.credentials).toMatchObject({ clientSecret: SECRET });
  });

  it("does not save credentials Shopify refuses", async () => {
    await fresh();
    const res = await call(app(), "POST", "/api/shopify/connection", { ...connectBody, clientSecret: "wrong" });
    expect(res.status).toBe(422);
    expect(await repo().getConnection()).toBeNull();
  });

  it("keeps the chosen location when the same store is reconnected, and drops it for a different store", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    await call(app(), "PUT", "/api/shopify/location", { id: LOC_A });
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    expect((await repo().getConnection())!.locationId).toBe(LOC_A);

    await call(app(), "POST", "/api/shopify/connection", { shop: "other-store.myshopify.com", clientId: CLIENT_ID, clientSecret: SECRET });
    expect((await repo().getConnection())).toMatchObject({ shop: "other-store.myshopify.com", locationId: null });
  });

  it("brings a connection that needed reconnecting back to connected", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    await repo().setStatus("needs_reconnect");
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    expect((await repo().getConnection())!.status).toBe("connected");
  });

  it("saves a legacy token", async () => {
    await fresh();
    const res = await call(app(), "POST", "/api/shopify/connection", { shop: SHOP, accessToken: STATIC_TOKEN });
    expect(at(res.body, "connection.credentialType")).toBe("static_token");
  });

  it("writes an audit event with the store and permissions but no secret", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    const rows = await audit("shopify.connected");
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ shop: SHOP, credentialType: "client_credentials" });
    expect(rows[0].actor_user_id).toBeTruthy();
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`${SECRET}|${CLIENT_ID}`));
  });

  it("refuses a bad store address before contacting anyone", async () => {
    await fresh();
    const res = await call(app(), "POST", "/api/shopify/connection", { ...connectBody, shop: "evil.com" });
    expect(res.status).toBe(400);
    expect(at(res.body, "error.message")).toBe("Enter your store address, like my-store.myshopify.com.");
    expect(fake.requests).toHaveLength(0);
  });
});

describe("GET and DELETE /api/shopify/connection", () => {
  it("shows no connection at first, then the safe record", async () => {
    await fresh();
    expect((await call(app(), "GET", "/api/shopify/connection")).body).toEqual({ connection: null });
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    const res = await call(app(), "GET", "/api/shopify/connection");
    expect(at(res.body, "connection.shop")).toBe(SHOP);
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${SECRET}|${CLIENT_ID}|cipher`, "i"));
  });

  it("disconnects, removing the stored credentials, and records it", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    const res = await call(app(), "DELETE", "/api/shopify/connection");
    expect(res.status).toBe(200);
    expect(await repo().getConnection()).toBeNull();
    expect((await t.pool.query("select count(*)::int as n from shopify_connection")).rows[0].n).toBe(0);
    expect(await audit("shopify.disconnected")).toHaveLength(1);
  });
});

describe("locations", () => {
  it("needs a connection", async () => {
    await fresh();
    const res = await call(app(), "GET", "/api/shopify/locations");
    expect(res.status).toBe(409);
    expect(at(res.body, "error")).toMatchObject({ code: "not_connected", message: "Connect Shopify first." });
  });

  it("lists the active locations", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    const res = await call(app(), "GET", "/api/shopify/locations");
    expect(at(res.body, "locations")).toEqual([{ id: LOC_A, name: "Shop floor" }, { id: LOC_B, name: "Back room" }]);
  });

  it("marks the connection as needing a reconnect when Shopify stops accepting it", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    fake.revokeIssuedTokens();
    fake.setGraphQL(() => ({ status: 401, body: {} }));
    const res = await call(app(), "GET", "/api/shopify/locations");
    expect(res.status).toBe(422);
    expect(at(res.body, "error.code")).toBe("shopify_rejected_credentials");
    expect((await repo().getConnection())!.status).toBe("needs_reconnect");
  });

  it("chooses a location by id, using the name Shopify gives, and records it", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    const res = await call(app(), "PUT", "/api/shopify/location", { id: LOC_B });
    expect(res.status).toBe(200);
    expect(at(res.body, "location")).toEqual({ id: LOC_B, name: "Back room" });
    expect(await repo().getConnection()).toMatchObject({ locationId: LOC_B, locationName: "Back room" });
    expect((await audit("shopify.location_chosen"))[0].details).toMatchObject({ locationId: LOC_B, locationName: "Back room" });
  });

  it("refuses a location that does not exist, is inactive, or is not a location id", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    for (const id of ["gid://shopify/Location/3", "gid://shopify/Location/999", "nonsense", ""]) {
      const res = await call(app(), "PUT", "/api/shopify/location", { id });
      expect(res.status).toBe(400);
      expect(at(res.body, "error.code")).toMatch(/invalid_location|invalid_input/);
    }
    expect((await repo().getConnection())!.locationId).toBeNull();
  });
});

describe("sync", () => {
  it("says what is missing before it queues anything", async () => {
    await fresh();
    let res = await call(app(), "POST", "/api/shopify/sync");
    expect(res.status).toBe(409);
    expect(at(res.body, "error")).toMatchObject({ code: "not_connected", message: "Connect Shopify first." });

    await call(app(), "POST", "/api/shopify/connection", connectBody);
    res = await call(app(), "POST", "/api/shopify/sync");
    expect(at(res.body, "error")).toMatchObject({ code: "no_location", message: "Choose an inventory location first." });

    await call(app(), "PUT", "/api/shopify/location", { id: LOC_A });
    await repo().setStatus("needs_reconnect");
    res = await call(app(), "POST", "/api/shopify/sync");
    expect(at(res.body, "error")).toMatchObject({ code: "needs_reconnect", message: "Shopify rejected the saved connection. Reconnect Shopify." });
    expect(queued).toEqual([]);
  });

  it("refuses to start another while one is running", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    await call(app(), "PUT", "/api/shopify/location", { id: LOC_A });
    await repo().startSyncRun();
    const res = await call(app(), "POST", "/api/shopify/sync");
    expect(res.status).toBe(409);
    expect(at(res.body, "error")).toMatchObject({ code: "sync_running", message: "A sync is already running." });
    expect(queued).toEqual([]);
  });

  it("queues a sync with no data in the job, and records the request", async () => {
    await fresh();
    await call(app(), "POST", "/api/shopify/connection", connectBody);
    await call(app(), "PUT", "/api/shopify/location", { id: LOC_A });
    const res = await call(app(), "POST", "/api/shopify/sync");
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: true });
    expect(queued).toEqual([{ name: "shopify.sync", payload: {} }]);
    expect(await audit("shopify.sync_requested")).toHaveLength(1);
  });

  it("reports the last run, or none", async () => {
    await fresh();
    expect((await call(app(), "GET", "/api/shopify/sync")).body).toEqual({ lastRun: null });
    const id = await repo().startSyncRun();
    await repo().finishSyncRun(id!, { status: "succeeded", result: { added: 2, updated: 0, unchanged: 0, removed: 0, total: 2 } });
    const res = await call(app(), "GET", "/api/shopify/sync");
    expect(at(res.body, "lastRun")).toMatchObject({ status: "succeeded", added: 2, total: 2, error: null });
  });
});

describe("GET /api/shopify/variants", () => {
  const save = (variants: CatalogVariant[]) => repo().catalogStore().save(variants);
  const base = (n: number, over: Partial<CatalogVariant> = {}): CatalogVariant => ({
    variantId: `gid://shopify/ProductVariant/${n}`,
    productId: "gid://shopify/Product/1",
    productTitle: `Product ${n}`,
    variantTitle: `Variant ${n}`,
    options: [{ name: "Size", value: String(n) }],
    sku: `SKU-${n}`,
    inventoryItemId: `gid://shopify/InventoryItem/${n}`,
    tracked: true,
    inventoryPolicy: "DENY",
    available: n,
    supplierName: null,
    supplierUrl: null,
    ...over,
  });

  it("lists variants with the fields the screen needs", async () => {
    await fresh();
    await save([base(1)]);
    const res = await call(app(), "GET", "/api/shopify/variants");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(Object.keys(at(res.body, "items.0") as object).sort()).toEqual(
      ["available", "inventoryPolicy", "options", "productTitle", "sku", "syncedAt", "tracked", "variantId", "variantTitle", "warnings"],
    );
    expect(at(res.body, "items.0.warnings")).toEqual([]);
  });

  it("explains each warning in plain words", async () => {
    await fresh();
    await save([base(1, { tracked: false }), base(2, { inventoryPolicy: "CONTINUE" })]);
    const res = await call(app(), "GET", "/api/shopify/variants");
    const byId = Object.fromEntries((at(res.body, "items") as unknown as Item[]).map((v) => [v.variantId, v.warnings]));
    expect(byId["gid://shopify/ProductVariant/1"]).toEqual([
      { code: "not_tracked", message: "Shopify is not tracking stock for this item, so quantity changes will have no effect." },
    ]);
    expect(byId["gid://shopify/ProductVariant/2"]).toEqual([{ code: "continue_selling", message: "This item keeps selling at 0." }]);
  });

  it("searches, filters to warnings and pages", async () => {
    await fresh();
    await save([base(1, { productTitle: "Gloves" }), base(2, { productTitle: "Gloves", tracked: false }), base(3, { productTitle: "Hose" })]);
    expect(at((await call(app(), "GET", "/api/shopify/variants?search=glove")).body, "total")).toBe(2);
    expect(at((await call(app(), "GET", "/api/shopify/variants?warningsOnly=true")).body, "total")).toBe(1);
    const page = (await call(app(), "GET", "/api/shopify/variants?pageSize=2&page=2")).body;
    expect(at(page, "items")).toHaveLength(1);
    expect(at(page, "total")).toBe(3);
  });

  it("keeps the available quantity empty when the variant is not stocked at the location", async () => {
    await fresh();
    await save([base(1, { available: null }), base(2, { available: 0 })]);
    const items = at((await call(app(), "GET", "/api/shopify/variants")).body, "items") as unknown as Item[];
    expect(items.find((v) => v.sku === "SKU-1")!.available).toBeNull();
    expect(items.find((v) => v.sku === "SKU-2")!.available).toBe(0);
  });

  it.each(["page=0", "page=abc", "pageSize=0", "pageSize=101", "pageSize=x", "warningsOnly=maybe", `search=${"a".repeat(101)}`])(
    "refuses %s with a plain message",
    async (query) => {
      await fresh();
      const res = await call(app(), "GET", `/api/shopify/variants?${query}`);
      expect(res.status).toBe(400);
      expect(at(res.body, "error.code")).toBe("invalid_input");
    },
  );
});

describe("nothing secret escapes", () => {
  it("keeps the client id, secret and tokens out of every response, audit event and log line", async () => {
    await fresh();
    const a = app();
    await call(a, "POST", "/api/shopify/test", connectBody);
    await call(a, "POST", "/api/shopify/connection", connectBody);
    await call(a, "GET", "/api/shopify/connection");
    await call(a, "GET", "/api/shopify/locations");
    await call(a, "PUT", "/api/shopify/location", { id: LOC_A });
    await call(a, "POST", "/api/shopify/sync");
    await call(a, "POST", "/api/shopify/test", { ...connectBody, clientSecret: "WRONG-SECRET-MARKER" });
    await call(a, "POST", "/api/shopify/connection", { shop: SHOP, accessToken: STATIC_TOKEN });
    await call(a, "POST", "/api/shopify/test", { shop: SHOP, accessToken: "WRONG-TOKEN-MARKER" });

    const everything = [
      ...bodies,
      JSON.stringify((await t.pool.query("select * from audit_events")).rows),
      logLines.join(""),
      JSON.stringify(queued),
    ].join("\n");
    for (const marker of [SECRET, CLIENT_ID, STATIC_TOKEN, "WRONG-SECRET-MARKER", "WRONG-TOKEN-MARKER", "fake-access-token"]) {
      expect(everything).not.toContain(marker);
    }
  });
});
