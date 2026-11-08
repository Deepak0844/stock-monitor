import { loadConfig, createLogger } from "@stock-monitor/shared";
import { createQueue } from "@stock-monitor/queue";
import { registerHandlers } from "./worker.js";

const config = loadConfig(process.env);
const logger = createLogger({ level: config.logLevel });
const queue = createQueue({
  connectionString: config.databaseUrl,
  onError: (error) => logger.error({ err: error }, "queue error"),
});

await queue.start();
await registerHandlers(queue, logger);
logger.info("worker started");

const shutdown = async () => {
  logger.info("worker stopping");
  await queue.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
