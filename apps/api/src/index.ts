import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createLogger, loadConfig } from "@stock-monitor/shared";
import { buildApp } from "./app.js";

const config = loadConfig(process.env);
const logger = createLogger({ level: config.logLevel });
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL("../../web/dist", import.meta.url));

const app = buildApp({
  db: drizzle(pool),
  logger,
  secureCookies: config.cookieSecure,
  trustProxy: config.trustProxy,
  webRoot,
});

await app.listen({ port: config.port, host: config.host });

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
