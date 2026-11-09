import type { Logger } from "pino";
import type { Queue } from "@stock-monitor/queue";
import { createShopifySyncHandler, type ShopifySyncDeps } from "./shopify-sync.js";
import { createLinkCheckHandlers, type LinkCheckDeps } from "./mapping-link-check.js";
import { createSupplierVerifyHandler, type SupplierVerifyDeps } from "./supplier-verify.js";

// Later modules register their job handlers here.
export type WorkerDeps = { shopify?: Omit<ShopifySyncDeps, "logger">; supplierVerify?: Omit<SupplierVerifyDeps, "logger">; mappingLinks?: Omit<LinkCheckDeps, "logger"> };

export async function registerHandlers(queue: Queue, logger: Logger, deps: WorkerDeps = {}): Promise<void> {
  await queue.work("health.ping", async ({ message }) => {
    logger.info({ message }, "health.ping processed");
  });

  if (deps.shopify) {
    const handle = createShopifySyncHandler({ ...deps.shopify, logger });
    await queue.work("shopify.sync", async (payload) => handle(payload));
  }

  if (deps.supplierVerify) {
    const handle = createSupplierVerifyHandler({ ...deps.supplierVerify, logger });
    await queue.work("supplier.session.verify", async (payload) => handle(payload));
  }

  if (deps.mappingLinks) {
    const handlers = createLinkCheckHandlers({ ...deps.mappingLinks, logger });
    await queue.work("mapping.link.check", async (payload) => handlers.link(payload));
    await queue.work("mapping.links.check", async (payload) => handlers.links(payload));
  }
}
