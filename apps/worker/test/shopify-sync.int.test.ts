import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createMappingRepository, createShopifyRepository, createSupplierRepository } from "@stock-monitor/db";
import { createQueue, type Queue } from "@stock-monitor/queue";
import { createLogger } from "@stock-monitor/shared";
import {
  LOC_A,
  createFakeCatalog,
  createFakeShopify,
  makeVariant,
  type FakeShopify,
} from "@stock-monitor/shopify/testing";
import { createShopifySyncHandler } from "../src/shopify-sync.js";
import { registerHandlers } from "../src/worker.js";

const CLIENT_ID = "CLIENT-ID-MARKER-7f3a";
const SECRET = "CLIENT-SECRET-MARKER-9c1e";
const SHOP = "my-store.myshopify.com";
const locations = [{ id: LOC_A, name: "Shop floor", isActive: true }];

let t: TestDb;
let fake: FakeShopify;
let queue: Queue | undefined;
const key = { key: randomBytes(32), keyId: "v1" };
const logLines: string[] = [];
const logger = createLogger({
  level: "info",
  stream: new Writable({
    write(chunk, _e, cb) {
      logLines.push(chunk.toString());
      cb();
    },
  }),
});

const repo = () => createShopifyRepository(t.appDb, key);
const handler = (over: Partial<Parameters<typeof createShopifySyncHandler>[0]> = {}) =>
  createShopifySyncHandler({
    repo: repo(),
    logger,
    baseUrl: () => fake.url,
    clientOptions: { sleep: async () => {} },
    ...over,
  });

const connect = async (over: { clientSecret?: string; location?: { id: string; name: string } | null } = {}) => {
  await repo().saveConnection({
    shop: SHOP,
    credentials: { type: "client_credentials", clientId: CLIENT_ID, clientSecret: over.clientSecret ?? SECRET },
    scopes: ["read_products", "read_inventory"],
    location: over.location === undefined ? { id: LOC_A, name: "Shop floor" } : over.location,
  });
};

const withCatalog = (count: number) => {
  const catalog = createFakeCatalog({ locations, variants: Array.from({ length: count }, (_, i) => makeVariant(i + 1)) });
  fake.setGraphQL(catalog.handler);
  return catalog;
};

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

const fresh = async () => {
  await t.pool.query("truncate shopify_connection, shopify_variants, shopify_sync_runs cascade");
  logLines.length = 0;
  fake = await createFakeShopify({ clientId: CLIENT_ID, clientSecret: SECRET });
};
afterEach(async () => {
  await queue?.stop();
  queue = undefined;
  await fake?.close();
});

describe("shopify sync handler", () => {
  it("syncs a fake store into the database and records the run", async () => {
    await fresh();
    withCatalog(3);
    await connect();
    await handler()({});
    const run = await repo().lastSyncRun();
    expect(run).toMatchObject({ status: "succeeded", added: 3, updated: 0, unchanged: 0, removed: 0, total: 3, error: null });
    expect(run!.finishedAt).toBeInstanceOf(Date);
    expect(await repo().catalogStore().getAll()).toHaveLength(3);
    expect(await repo().getConnection()).toMatchObject({ status: "connected" });
    expect((await repo().getConnection())!.lastSuccessfulCallAt).toBeInstanceOf(Date);
  });

  it("changes nothing on a second run", async () => {
    await fresh();
    withCatalog(3);
    await connect();
    await handler()({});
    await handler()({});
    expect(await repo().lastSyncRun()).toMatchObject({ status: "succeeded", added: 0, updated: 0, unchanged: 3, total: 3 });
  });

  it("reports progress while it runs", async () => {
    await fresh();
    withCatalog(120);
    await connect();
    const real = repo();
    const seen: number[] = [];
    const spyRepo = { ...real, updateSyncProgress: async (id: number, n: number) => (seen.push(n), real.updateSyncProgress(id, n)) };
    await handler({ repo: spyRepo as never })({});
    expect(seen).toEqual([50, 100, 120]);
  });

  it("does not start a second sync while one is still running", async () => {
    await fresh();
    const catalog = withCatalog(3);
    await connect();

    // Hold the first sync open inside Shopify's reply, so the others really do arrive while it is running.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fake.setGraphQL(async (request, count) => {
      await gate;
      return catalog.handler(request, count);
    });

    const first = handler()({});
    await vi.waitFor(async () => {
      const { rows } = await t.pool.query("select count(*)::int as n from shopify_sync_runs where status = 'running'");
      expect(rows[0].n).toBe(1);
    });

    await Promise.all([handler()({}), handler()({})]); // both must return without starting a run
    const during = await t.pool.query("select count(*)::int as n from shopify_sync_runs");
    expect(during.rows[0].n).toBe(1);
    expect(logLines.join("").match(/already running/g)).toHaveLength(2);

    release();
    await first;
    expect(await repo().lastSyncRun()).toMatchObject({ status: "succeeded", added: 3 });
    const after = await t.pool.query("select count(*)::int as n from shopify_sync_runs");
    expect(after.rows[0].n).toBe(1);
    expect(fake.graphqlRequests()).toHaveLength(1); // one page of one sync
  });

  it("starts a new sync once the previous one has finished", async () => {
    await fresh();
    withCatalog(3);
    await connect();
    await handler()({});
    await handler()({});
    const { rows } = await t.pool.query("select count(*)::int as n from shopify_sync_runs");
    expect(rows[0].n).toBe(2);
  });

  it("fails clearly when Shopify has not been connected", async () => {
    await fresh();
    withCatalog(1);
    await handler()({});
    expect(await repo().lastSyncRun()).toMatchObject({ status: "failed", error: "Connect Shopify first." });
    expect(fake.requests).toHaveLength(0);
  });

  it("fails clearly when no location has been chosen", async () => {
    await fresh();
    withCatalog(1);
    await connect({ location: null });
    await handler()({});
    expect(await repo().lastSyncRun()).toMatchObject({ status: "failed", error: "Choose an inventory location first." });
    expect(fake.requests).toHaveLength(0);
  });

  it("asks for a reconnect when Shopify rejects the credentials, and a later good sync restores the connection", async () => {
    await fresh();
    withCatalog(2);
    await connect({ clientSecret: "WRONG-SECRET" });
    await handler()({});
    expect(await repo().lastSyncRun()).toMatchObject({
      status: "failed",
      error: "Shopify rejected the saved connection. Reconnect Shopify.",
    });
    expect((await repo().getConnection())!.status).toBe("needs_reconnect");

    await connect(); // the owner reconnects with the right secret
    await repo().setStatus("needs_reconnect");
    await handler()({});
    expect(await repo().lastSyncRun()).toMatchObject({ status: "succeeded" });
    expect((await repo().getConnection())!.status).toBe("connected");
  });

  it("asks for a reconnect when the app and store are in different organizations", async () => {
    await fresh();
    withCatalog(1);
    await connect();
    fake.setMode("wrong_organization");
    await handler()({});
    expect((await repo().lastSyncRun())!.error).toMatch(/different organisations/);
    expect((await repo().getConnection())!.status).toBe("needs_reconnect");
  });

  it("keeps the connection when Shopify is only temporarily unreachable", async () => {
    await fresh();
    withCatalog(1);
    await connect();
    fake.setMode("server_error");
    await handler()({});
    expect(await repo().lastSyncRun()).toMatchObject({
      status: "failed",
      error: "Can't reach Shopify right now. Try again in a few minutes.",
    });
    expect((await repo().getConnection())!.status).toBe("connected");
  });

  it("leaves earlier data alone and marks nothing removed when a sync fails part way", async () => {
    await fresh();
    const catalog = withCatalog(120);
    await connect();
    await handler()({});
    catalog.setVariants(Array.from({ length: 119 }, (_, i) => makeVariant(i + 2))); // variant 1 is gone
    catalog.failAtVariantPage(2);
    await handler()({});
    expect((await repo().lastSyncRun())!.status).toBe("failed");
    const all = await repo().catalogStore().getAll();
    expect(all).toHaveLength(120);
    expect(all.every((v) => !v.removed)).toBe(true);
  });

  it("records a plain message, and logs the problem, for a failure that is not from Shopify", async () => {
    await fresh();
    withCatalog(2);
    await connect();
    const real = repo();
    const broken = {
      ...real,
      catalogStore: () => ({ ...real.catalogStore(), save: async () => { throw new Error("connection to database lost: password=DB-SECRET-MARKER"); } }),
    };
    await expect(handler({ repo: broken as never })({})).resolves.toBeUndefined(); // must not throw, or the queue would retry it
    expect(await repo().lastSyncRun()).toMatchObject({ status: "failed", error: "Something went wrong while syncing. Try again." });
    expect(logLines.join("")).toContain("sync failed");
  });

  it("never puts a secret in the run record, the logs or the job data", async () => {
    await fresh();
    withCatalog(2);
    await connect();
    await handler()({});
    await connect({ clientSecret: "WRONG-SECRET" });
    await handler()({});
    const runs = JSON.stringify((await t.pool.query("select * from shopify_sync_runs")).rows);
    const everything = `${runs} ${logLines.join("")}`;
    for (const marker of [SECRET, CLIENT_ID, "fake-access-token", "WRONG-SECRET"]) {
      expect(everything).not.toContain(marker);
    }
  });
});

describe("through the real queue", () => {
  it("processes a shopify.sync job with an empty payload", async () => {
    await fresh();
    withCatalog(3);
    await connect();
    queue = createQueue({ connectionString: t.appUrl });
    await queue.start();
    await registerHandlers(queue, logger, { shopify: { repo: repo(), baseUrl: () => fake.url, clientOptions: { sleep: async () => {} } } });
    await queue.enqueue("shopify.sync", {});
    await vi.waitFor(async () => expect((await repo().lastSyncRun())?.status).toBe("succeeded"), { timeout: 30_000, interval: 250 });
    expect((await repo().lastSyncRun())!.added).toBe(3);
    const job = await t.pool.query("select data from pgboss.job where name = 'shopify.sync'");
    expect(job.rows.every((r) => JSON.stringify(r.data) === "{}")).toBe(true);
  }, 60_000);

  it("refuses to queue a shopify.sync job that carries data", async () => {
    await fresh();
    queue = createQueue({ connectionString: t.appUrl });
    await queue.start();
    await expect(queue.enqueue("shopify.sync", { clientSecret: SECRET } as never)).rejects.toThrow(/shopify\.sync/);
  });
});

describe("links set from Shopify's supplier fields", () => {
  const linkDeps = () => ({ mappings: createMappingRepository(t.appDb), suppliers: createSupplierRepository(t.appDb) });
  const withLinks = (variants: ReturnType<typeof makeVariant>[]) => fake.setGraphQL(createFakeCatalog({ locations, variants }).handler);
  const setup = async () => {
    await fresh();
    await t.pool.query("truncate suppliers cascade");
    await connect();
    const acme = await createSupplierRepository(t.appDb).create({ name: "Acme Foods", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
    if (!acme.ok) throw new Error("setup");
    return acme.supplier.id;
  };
  const links = async () => (await createMappingRepository(t.appDb).list({})).map((m) => ({ sku: m.sku, supplierId: m.supplierId, url: m.url }));

  it("creates a link for a product with a good supplier name and page address, skips and explains a bad one, and leaves a variant with none alone", async () => {
    const acme = await setup();
    withLinks([
      makeVariant(1, { supplierName: "acme foods", supplierUrl: "https://acme.example/p/1?_pos=3" }),
      makeVariant(2, { supplierName: "Nobody", supplierUrl: "https://acme.example/p/2" }),
      makeVariant(3),
    ]);
    await handler(linkDeps())({});
    expect(await links()).toEqual([{ sku: "SKU-1", supplierId: acme, url: "https://acme.example/p/1" }]);
    const run = await repo().lastSyncRun();
    expect(run).toMatchObject({ status: "succeeded" });
    expect(run!.links).toEqual({ added: 1, updated: 0, skipped: 1, problems: [{ product: "Product 1 (Size 2)", sku: "SKU-2", message: 'Supplier "Nobody" is not in the app.' }] });
  });

  it("changes nothing on a second run, and replaces the link when Shopify's address changes (Shopify is the one source)", async () => {
    const acme = await setup();
    withLinks([makeVariant(1, { supplierName: "Acme Foods", supplierUrl: "https://acme.example/p/1" })]);
    await handler(linkDeps())({});
    await handler(linkDeps())({});
    expect((await repo().lastSyncRun())!.links).toEqual({ added: 0, updated: 0, skipped: 0, problems: [] });

    withLinks([makeVariant(1, { supplierName: "Acme Foods", supplierUrl: "https://acme.example/p/1-new" })]);
    await handler(linkDeps())({});
    expect((await repo().lastSyncRun())!.links).toMatchObject({ added: 0, updated: 1 });
    expect(await links()).toEqual([{ sku: "SKU-1", supplierId: acme, url: "https://acme.example/p/1-new" }]);
  });

  it("leaves a link made by hand on a variant that has no Shopify fields", async () => {
    const acme = await setup();
    withLinks([makeVariant(1), makeVariant(2, { supplierName: "Acme Foods", supplierUrl: "https://acme.example/p/2" })]);
    await handler(linkDeps())({}); // first sync saves the variants
    const [first] = (await repo().catalogStore().getAll()).filter((v) => v.sku === "SKU-1");
    await createMappingRepository(t.appDb).create({ variantId: first!.variantId, supplierId: acme, url: "https://acme.example/by-hand", note: "mine" });
    await handler(linkDeps())({});
    expect(await links()).toEqual([
      { sku: "SKU-1", supplierId: acme, url: "https://acme.example/by-hand" },
      { sku: "SKU-2", supplierId: acme, url: "https://acme.example/p/2" },
    ]);
  });

  it("does not touch links, and leaves no link result, when the handler is not given the link repositories", async () => {
    await setup();
    withLinks([makeVariant(1, { supplierName: "Acme Foods", supplierUrl: "https://acme.example/p/1" })]);
    await handler()({});
    expect(await links()).toEqual([]);
    expect((await repo().lastSyncRun())!.links).toBeNull();
  });
});
