// Starts everything a browser test needs: a throwaway PostgreSQL in Docker, a fake Shopify, the real
// job queue and worker handler, the API serving the built web app (npm run build first), and one
// owner account. A small control server lets tests reset and steer the fake Shopify. Stops cleanly on
// SIGTERM and SIGINT.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { startTestDb } from "../packages/db/test/harness.js";
import {
  createCaptureRepository,
  createCheckRunRepository,
  createImportPreviewRepository,
  createLoginSessionRepository,
  createMappingRepository,
  createNotificationRepository,
  createObservationRepository,
  createProposalRepository,
  createRecipeRepository,
  createShopifyRepository,
  createSupplierRepository,
  createSupplierSessionRepository,
} from "../packages/db/src/index.js";
import { createAuditWriter } from "../packages/audit/src/index.js";
import { runTick } from "../apps/worker/src/scheduling-tick.js";
import { createBrowserClient } from "../packages/browser-client/src/index.js";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN } from "../packages/browser-client/test/fake-browser-service.js";
import { createQueue } from "../packages/queue/src/index.js";
import { createLogger } from "../packages/shared/src/index.js";
import { sealSessionState } from "../packages/supplier-session/src/index.js";
import { createFakeCatalog, createFakeShopify, LOC_A, makeVariant, withFakeShop } from "../packages/shopify/test/testing.js";
import { buildApp } from "../apps/api/src/app.js";
import { createOwner } from "../apps/api/src/owner.js";
import { registerHandlers } from "../apps/worker/src/worker.js";
import { LOCATIONS, VARIANTS } from "./catalog.js";
import { startFakeVnc } from "./fake-vnc.js";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  CONTROL_PORT,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  BASE_URL,
  PORT,
  SHOP_NAME,
} from "./constants.js";

const webRoot = fileURLToPath(new URL("../apps/web/dist", import.meta.url));
const logger = createLogger({ level: "warn" });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const db = await startTestDb();
await createOwner(db.appDb, { email: OWNER_EMAIL, password: OWNER_PASSWORD });

// The fake Shopify store. Product pages are slowed a little so the "Syncing…" state can be seen.
const fake = await createFakeShopify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
const catalog = createFakeCatalog({ locations: LOCATIONS, variants: VARIANTS });
const slowCatalog: Parameters<typeof withFakeShop>[0] = async (request, count) => {
  if (/productVariants/.test(request.query)) await sleep(400);
  return catalog.handler(request, count);
};
const serve = (scopes: string[]) => fake.setGraphQL(withFakeShop(slowCatalog, { shopName: SHOP_NAME, scopes }));
const DEFAULT_SCOPES = ["read_products", "read_inventory"];
serve(DEFAULT_SCOPES);

// The real queue and the real worker handler, so a sync takes the same path as in production.
const encryption = { key: randomBytes(32), keyId: "v1" };
const repo = createShopifyRepository(db.appDb, encryption);
const baseUrl = () => fake.url;
const queue = createQueue({ connectionString: db.appUrl, onError: (e) => logger.error({ err: e }, "queue error") });
await queue.start();

// The browser service is a stand-in that answers like the real one, and its screen is a stand-in VNC server
// that draws a login page. Everything between them and the browser is the real code.
const browser = await createFakeBrowserService();
const vnc = await startFakeVnc();
const browserClient = createBrowserClient({ baseUrl: browser.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 5000 });
const suppliers = createSupplierRepository(db.appDb);
const loginSessions = createLoginSessionRepository(db.appDb);
const supplierSessions = createSupplierSessionRepository(db.appDb);
const notifications = createNotificationRepository(db.appDb);
const E2E_SESSION = { cookies: [{ name: "session", value: "e2e-session-value", domain: "shop.acme.example", path: "/" }], origins: [] };
const DEFAULT_DESCRIPTION = { sections: [{ heading: "Blue Tee", level: 1, lines: ["Soft cotton."] }], buttons: [{ label: "Add to cart", enabled: true, section: "Blue Tee" }] };
const resetBrowser = () => Object.assign(browser.behaviour, { open: "ok", finish: "ok", cancel: "ok", verify: "ok", verifyResult: "ok", checkPage: "ok", capture: "ok", description: DEFAULT_DESCRIPTION, descriptionFor: undefined, pageFor: undefined, page: { result: "ok", status: 200, title: "Blue Tee", heading: "Blue Tee", softNotFound: false }, vncPassword: "Ab3dE6gH", state: E2E_SESSION, delayMs: 0 });
resetBrowser();

await registerHandlers(queue, logger, {
  shopify: { repo, baseUrl, clientOptions: { sleep: async () => {} } },
  extractionCapture: { captures: createCaptureRepository(db.appDb), mappings: createMappingRepository(db.appDb), suppliers, supplierSessions, browser: browserClient, key: encryption.key },
  extractionChecks: {
    mappings: createMappingRepository(db.appDb), suppliers, supplierSessions, recipes: createRecipeRepository(db.appDb), observations: createObservationRepository(db.appDb),
    captures: createCaptureRepository(db.appDb), notifications, audit: createAuditWriter(db.appDb), checkRuns: createCheckRunRepository(db.appDb), timezone: "UTC", browser: browserClient, key: encryption.key, sleep: async () => {},
  },
  mappingLinks: { mappings: createMappingRepository(db.appDb), suppliers, supplierSessions, audit: createAuditWriter(db.appDb), browser: browserClient, key: encryption.key, sleep: async () => {} },
  proposals: { mappings: createMappingRepository(db.appDb), observations: createObservationRepository(db.appDb), shopify: repo, proposals: createProposalRepository(db.appDb) },
  proposalsApply: { proposals: createProposalRepository(db.appDb), shopify: repo, audit: createAuditWriter(db.appDb), notifications, queue, baseUrl, clientOptions: { sleep: async () => {} } },
  supplierVerify: { suppliers, supplierSessions, notifications, audit: createAuditWriter(db.appDb), browser: browserClient, key: encryption.key, retryDelaysMs: [], sleep: async () => {} },
});

// No real DNS in browser tests. Every supplier name resolves to a public address, except one that
// stands for a name pointing at the owner's own network.
const lookup = async (host: string) => (host === "internal.example" ? ["10.0.0.5"] : ["93.184.216.34"]);

const app = buildApp({
  db: db.appDb,
  logger,
  webRoot,
  suppliers: { repo: suppliers, lookup },
  mappings: { mappings: createMappingRepository(db.appDb), suppliers, previews: createImportPreviewRepository(db.appDb), supplierSessions, queue, lookup, observations: createObservationRepository(db.appDb), proposals: createProposalRepository(db.appDb) },
  captures: { captures: createCaptureRepository(db.appDb), mappings: createMappingRepository(db.appDb), suppliers, supplierSessions, queue },
  recipes: { recipes: createRecipeRepository(db.appDb), captures: createCaptureRepository(db.appDb), mappings: createMappingRepository(db.appDb), suppliers },
  schedule: { suppliers, supplierSessions, recipes: createRecipeRepository(db.appDb), checkRuns: createCheckRunRepository(db.appDb), timezone: "UTC" },
  stockChecks: { mappings: createMappingRepository(db.appDb), suppliers, supplierSessions, recipes: createRecipeRepository(db.appDb), observations: createObservationRepository(db.appDb), checkRuns: createCheckRunRepository(db.appDb), queue },
  notifications: { repo: notifications },
  loginSessions: { suppliers, loginSessions, supplierSessions, browser: browserClient, key: encryption, notifications, queue },
  loginScreen: { allowedOrigins: [BASE_URL], vnc: { host: "127.0.0.1", port: vnc.port }, firstMessageTimeoutMs: 5000 },
  shopify: { repo, queue, baseUrl, clientOptions: { sleep: async () => {} } },
  proposals: { proposals: createProposalRepository(db.appDb), shopify: repo, notifications, queue },
});

// Control channel for the tests. Listens on this machine only.
const control = createServer(async (req, res) => {
  const body = await new Promise<string>((resolve) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => resolve(text));
  });
  const reply = (status: number, payload: unknown = { ok: true }) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  try {
    if (req.method === "POST" && req.url === "/control/reset") {
      await db.pool.query("truncate shopify_connection, shopify_variants, shopify_sync_runs cascade");
      fake.setCredentials({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
      fake.setMode("ok");
      serve(DEFAULT_SCOPES);
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/reset-suppliers") {
      await db.pool.query("truncate suppliers cascade");
      resetBrowser();
      await vnc.setAvailable(true);
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/reset-mappings") {
      // A clean slate for the link journeys: three variants Shopify has, one it removed, and one connected supplier
      // whose permission is not recorded yet. They run in their own projects, after every other journey.
      await db.pool.query("truncate suppliers, shopify_variants, import_previews, audit_events cascade");
      resetBrowser();
      for (const [id, sku, title, removed] of [["v1", "B0361", "Large", false], ["v2", "B0362", "Small", false], ["v3", "B0363", "Medium", false], ["old", "B0000", "Retired", true]] as const) {
        await db.pool.query(
          `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy, removed_at)
           values ($1, 'p1', 'Blue Tee', $2, '[]', $3, $4, true, 'DENY', ${removed ? "now()" : "null"})`,
          [id, title, sku, `inv-${id}`],
        );
      }
      const made = await suppliers.create({ name: "Acme Supply", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
      if (!made.ok) return reply(500, { error: "seed failed" });
      await supplierSessions.save(made.supplier.id, sealSessionState(E2E_SESSION, encryption.key, encryption.keyId), E2E_SESSION);
      await suppliers.markConnected(made.supplier.id);
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/reset-extraction") {
      // A clean slate for the stock rule journeys: six variants, each with a link to one connected supplier that is allowed
      // to be checked, and no rules, captures or answers. They run in their own projects, after every other journey.
      await db.pool.query("truncate suppliers, shopify_variants, import_previews, audit_events cascade");
      resetBrowser();
      const made = await suppliers.create({ name: "Acme Supply", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
      if (!made.ok) return reply(500, { error: "seed failed" });
      await supplierSessions.save(made.supplier.id, sealSessionState(E2E_SESSION, encryption.key, encryption.keyId), E2E_SESSION);
      await suppliers.markConnected(made.supplier.id);
      await suppliers.setPermission(made.supplier.id, { status: "granted", note: null });
      for (let n = 1; n <= 6; n++) {
        await db.pool.query(
          `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
           values ($1, 'p1', 'Blue Tee', $2, '[]', $3, $4, true, 'DENY')`,
          [`v${n}`, `Size ${n}`, `B036${n}`, `inv-${n}`],
        );
        await createMappingRepository(db.appDb).create({ variantId: `v${n}`, supplierId: made.supplier.id, url: `https://shop.acme.example/p/${n}`, note: null });
      }
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/reset-proposals") {
      // A clean slate for the suggestion journeys: three variants, stocked at 4 in the fake store and synced, each linked to one
      // connected, allowed supplier with stock rules on, and a Shopify connection that may or may not change stock.
      const { scopes = ["read_products", "read_inventory", "write_inventory"] } = (body ? JSON.parse(body) : {}) as { scopes?: string[] };
      await db.pool.query("truncate suppliers, shopify_variants, shopify_connection, shopify_sync_runs, import_previews, audit_events, app_settings cascade");
      resetBrowser();
      catalog.setVariants([1, 2, 3].map((n) => makeVariant(n, { productTitle: "Blue Tee", title: `Size ${n}`, sku: `B036${n}`, stock: { [LOC_A]: 4 } })));
      catalog.writes.length = 0; // the count of accepted stock writes starts again with each journey
      catalog.setCanWrite(scopes.includes("write_inventory"));
      serve(scopes);
      await repo.saveConnection({ shop: "e2e-store.myshopify.com", credentials: { type: "client_credentials", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, scopes, location: { id: LOC_A, name: "Shop floor" } });
      const made = await suppliers.create({ name: "Acme Supply", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
      if (!made.ok) return reply(500, { error: "seed failed" });
      await supplierSessions.save(made.supplier.id, sealSessionState(E2E_SESSION, encryption.key, encryption.keyId), E2E_SESSION);
      await suppliers.markConnected(made.supplier.id);
      await suppliers.setPermission(made.supplier.id, { status: "granted", note: null });
      for (const n of [1, 2, 3]) {
        await db.pool.query(
          `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy, available)
           values ($1, 'gid://shopify/Product/1', 'Blue Tee', $2, '[]', $3, $4, true, 'DENY', 4)`,
          [`gid://shopify/ProductVariant/${n}`, `Size ${n}`, `B036${n}`, `gid://shopify/InventoryItem/${n}`],
        );
        await createMappingRepository(db.appDb).create({ variantId: `gid://shopify/ProductVariant/${n}`, supplierId: made.supplier.id, url: `https://shop.acme.example/p/${n}`, note: null });
      }
      const recipes = createRecipeRepository(db.appDb);
      const saved = await recipes.create(made.supplier.id, { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [{ type: "button", label: "Add to cart", enabled: true }], outOfStock: [{ type: "text", text: "Sold out" }] });
      await recipes.activate(saved.id);
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/shopify-stock") {
      // Change a number in the fake store behind the app's back, as a sale or a staff edit would.
      const { item, quantity } = JSON.parse(body) as { item: number; quantity: number };
      catalog.setStock(`gid://shopify/InventoryItem/${item}`, LOC_A, quantity);
      return reply(200);
    }
    if (req.method === "GET" && req.url?.startsWith("/control/shopify-stock")) {
      const item = Number(new URL(req.url, "http://x").searchParams.get("item"));
      return reply(200, { quantity: catalog.stockOf(`gid://shopify/InventoryItem/${item}`, LOC_A) ?? null, writes: catalog.writes.length });
    }
    if (req.method === "POST" && req.url === "/control/seed-recipe") {
      // Turns rules on directly, so a journey about checking stock does not have to build them first.
      const [row] = (await db.pool.query("select id from suppliers limit 1")).rows as { id: string }[];
      const recipes = createRecipeRepository(db.appDb);
      const saved = await recipes.create(row!.id, (JSON.parse(body) as { rules: unknown }).rules);
      await recipes.activate(saved.id);
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/tick") {
      // One pass of the scheduler, as if `advanceMinutes` had gone by. The cron that does this every minute is not running here.
      const { advanceMinutes = 0 } = (body ? JSON.parse(body) : {}) as { advanceMinutes?: number };
      const result = await runTick({
        suppliers, supplierSessions, recipes: createRecipeRepository(db.appDb), mappings: createMappingRepository(db.appDb), checkRuns: createCheckRunRepository(db.appDb), proposals: createProposalRepository(db.appDb),
        queue, audit: createAuditWriter(db.appDb), logger, timezone: "UTC", now: () => new Date(Date.now() + advanceMinutes * 60_000),
      });
      return reply(200, result);
    }
    if (req.method === "POST" && req.url === "/control/vnc") {
      await vnc.setAvailable((JSON.parse(body) as { available: boolean }).available);
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/browser") {
      Object.assign(browser.behaviour, JSON.parse(body) as object);
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/rotate-secret") {
      const { clientSecret } = JSON.parse(body) as { clientSecret: string };
      fake.setCredentials({ clientId: CLIENT_ID, clientSecret });
      fake.revokeIssuedTokens();
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/scopes") {
      serve((JSON.parse(body) as { scopes: string[] }).scopes);
      return reply(200);
    }
    if (req.method === "GET" && req.url === "/control/shopify-request-count") {
      return reply(200, { count: fake.requests.length });
    }
    return reply(404, { error: "unknown control call" });
  } catch {
    return reply(500, { error: "control call failed" });
  }
});
await new Promise<void>((resolve) => control.listen(CONTROL_PORT, "127.0.0.1", resolve));

await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`e2e stack ready on port ${PORT}`);

let stopping = false;
const stop = async () => {
  if (stopping) return; // Playwright sends both SIGTERM and SIGINT
  stopping = true;
  control.close();
  await app.close();
  await vnc.close();
  await browser.close();
  await queue.stop();
  await fake.close();
  await db.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
