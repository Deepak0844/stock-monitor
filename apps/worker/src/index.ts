import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { KEY_ID } from "@stock-monitor/crypto";
import { createShopifyRepository } from "@stock-monitor/db";
import { createQueue } from "@stock-monitor/queue";
import { createLogger, loadConfig } from "@stock-monitor/shared";
import { registerHandlers } from "./worker.js";

const config = loadConfig(process.env);
const logger = createLogger({ level: config.logLevel });
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const queue = createQueue({
  connectionString: config.databaseUrl,
  onError: (error) => logger.error({ err: error }, "queue error"),
});

await queue.start();
await registerHandlers(queue, logger, {
  shopify: {
    repo: createShopifyRepository(drizzle(pool), { key: config.encryptionKey, keyId: KEY_ID }),
    // Test only. The config refuses to start in production with this set.
    baseUrl: config.shopifyBaseUrlOverride ? () => config.shopifyBaseUrlOverride as string : undefined,
  },
});
logger.info("worker started");

const shutdown = async () => {
  logger.info("worker stopping");
  await queue.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
