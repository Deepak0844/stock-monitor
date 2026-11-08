// Starts everything a browser test needs: a throwaway PostgreSQL in Docker, a fake Shopify, the real
// job queue and worker handler, the API serving the built web app (npm run build first), and one
// owner account. A small control server lets tests reset and steer the fake Shopify. Stops cleanly on
// SIGTERM and SIGINT.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { startTestDb } from "../packages/db/test/harness.js";
import { createShopifyRepository, createSupplierRepository } from "../packages/db/src/index.js";
import { createQueue } from "../packages/queue/src/index.js";
import { createLogger } from "../packages/shared/src/index.js";
import { createFakeCatalog, createFakeShopify, withFakeShop } from "../packages/shopify/test/testing.js";
import { buildApp } from "../apps/api/src/app.js";
import { createOwner } from "../apps/api/src/owner.js";
import { registerHandlers } from "../apps/worker/src/worker.js";
import { LOCATIONS, VARIANTS } from "./catalog.js";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  CONTROL_PORT,
  OWNER_EMAIL,
  OWNER_PASSWORD,
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
const repo = createShopifyRepository(db.appDb, { key: randomBytes(32), keyId: "v1" });
const baseUrl = () => fake.url;
const queue = createQueue({ connectionString: db.appUrl, onError: (e) => logger.error({ err: e }, "queue error") });
await queue.start();
await registerHandlers(queue, logger, { shopify: { repo, baseUrl, clientOptions: { sleep: async () => {} } } });

// No real DNS in browser tests. Every supplier name resolves to a public address, except one that
// stands for a name pointing at the owner's own network.
const lookup = async (host: string) => (host === "internal.example" ? ["10.0.0.5"] : ["93.184.216.34"]);

const app = buildApp({
  db: db.appDb,
  logger,
  webRoot,
  suppliers: { repo: createSupplierRepository(db.appDb), lookup },
  shopify: { repo, queue, baseUrl, clientOptions: { sleep: async () => {} } },
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
      await db.pool.query("truncate shopify_connection, shopify_variants, shopify_sync_runs");
      fake.setCredentials({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
      fake.setMode("ok");
      serve(DEFAULT_SCOPES);
      return reply(200);
    }
    if (req.method === "POST" && req.url === "/control/reset-suppliers") {
      await db.pool.query("truncate suppliers");
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
  await queue.stop();
  await fake.close();
  await db.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
