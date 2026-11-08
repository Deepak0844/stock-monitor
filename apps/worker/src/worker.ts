import type { Logger } from "pino";
import type { Queue } from "@stock-monitor/queue";

// Later modules register their job handlers here.
export async function registerHandlers(queue: Queue, logger: Logger): Promise<void> {
  await queue.work("health.ping", async ({ message }) => {
    logger.info({ message }, "health.ping processed");
  });
}
