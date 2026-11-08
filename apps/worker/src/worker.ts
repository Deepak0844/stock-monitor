import type { Logger } from "pino";
import type { Queue } from "@stock-monitor/queue";
import { createShopifySyncHandler, type ShopifySyncDeps } from "./shopify-sync.js";

// Later modules register their job handlers here.
export type WorkerDeps = { shopify?: Omit<ShopifySyncDeps, "logger"> };

export async function registerHandlers(queue: Queue, logger: Logger, deps: WorkerDeps = {}): Promise<void> {
  await queue.work("health.ping", async ({ message }) => {
    logger.info({ message }, "health.ping processed");
  });

  if (deps.shopify) {
    const handle = createShopifySyncHandler({ ...deps.shopify, logger });
    await queue.work("shopify.sync", async (payload) => handle(payload));
  }
}
