import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { KEY_ID } from "@stock-monitor/crypto";
import {
  createLoginSessionRepository,
  createNotificationRepository,
  createShopifyRepository,
  createMappingRepository, createSupplierRepository,
  createSupplierSessionRepository,
} from "@stock-monitor/db";
import { createQueue } from "@stock-monitor/queue";
import { createLogger, loadConfig } from "@stock-monitor/shared";
import { buildApp } from "./app.js";
import { createBrowserClient } from "@stock-monitor/browser-client";

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
  notifications: { repo: createNotificationRepository(db) },
  mappings: { mappings: createMappingRepository(db), suppliers: createSupplierRepository(db) },
  // The login routes need the browser service. Without its address and token the API has no login routes.
  loginSessions:
    config.browserServiceUrl && config.browserControlToken
      ? {
          suppliers: createSupplierRepository(db),
          loginSessions: createLoginSessionRepository(db),
          supplierSessions: createSupplierSessionRepository(db),
          browser: createBrowserClient({ baseUrl: config.browserServiceUrl, token: config.browserControlToken }),
          key: { key: config.encryptionKey, keyId: KEY_ID },
          notifications: createNotificationRepository(db),
          queue,
        }
      : undefined,
  // The live screen. It only accepts pages from the app's own origin: APP_ORIGIN, or localhost on this port when it is not set.
  loginScreen:
    config.browserServiceUrl && config.browserControlToken
      ? {
          allowedOrigins: config.appOrigin ? [config.appOrigin] : [`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`],
          vnc: { host: new URL(config.browserServiceUrl).hostname, port: config.browserVncPort },
        }
      : undefined,
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
