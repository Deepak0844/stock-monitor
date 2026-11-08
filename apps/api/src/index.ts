import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { KEY_ID } from "@stock-monitor/crypto";
import { createShopifyRepository, createSupplierRepository } from "@stock-monitor/db";
import { createQueue } from "@stock-monitor/queue";
import { createLogger, loadConfig } from "@stock-monitor/shared";
import { buildApp } from "./app.js";

const config = loadConfig(process.env);
const logger = createLogger({ level: config.logLevel });
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL("../../web/dist", import.meta.url));

// The API only adds jobs. The worker runs them.
const queue = createQueue({
  connectionString: config.databaseUrl,
  onError: (error) => logger.error({ err: error }, "queue error"),
});
await queue.start();

const db = drizzle(pool);
const app = buildApp({
  db,
  logger,
  secureCookies: config.cookieSecure,
  trustProxy: config.trustProxy,
  webRoot,
  suppliers: { repo: createSupplierRepository(db) },
  shopify: {
    repo: createShopifyRepository(db, { key: config.encryptionKey, keyId: KEY_ID }),
    queue,
    // Test only. The config refuses to start in production with this set.
    baseUrl: config.shopifyBaseUrlOverride ? () => config.shopifyBaseUrlOverride as string : undefined,
  },
});

await app.listen({ port: config.port, host: config.host });

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  await queue.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
