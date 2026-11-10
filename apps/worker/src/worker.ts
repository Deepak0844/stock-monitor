import type { Logger } from "pino";
import type { Queue } from "@stock-monitor/queue";
import { createShopifySyncHandler, type ShopifySyncDeps } from "./shopify-sync.js";
import { createCaptureHandler, type CaptureDeps } from "./extraction-capture.js";
import { createStockCheckHandlers, type StockCheckDeps } from "./extraction-check.js";
import { createLinkCheckHandlers, type LinkCheckDeps } from "./mapping-link-check.js";
import { createProposalsEvaluateHandler, type ProposalsEvaluateDeps } from "./proposals-evaluate.js";
import { reapStaleRuns, runTick, type TickDeps } from "./scheduling-tick.js";
import { createSupplierVerifyHandler, type SupplierVerifyDeps } from "./supplier-verify.js";

// Later modules register their job handlers here.
export type WorkerDeps = { shopify?: Omit<ShopifySyncDeps, "logger">; supplierVerify?: Omit<SupplierVerifyDeps, "logger">; mappingLinks?: Omit<LinkCheckDeps, "logger">; extractionCapture?: Omit<CaptureDeps, "logger">; extractionChecks?: Omit<StockCheckDeps, "logger">; scheduling?: Omit<TickDeps, "logger">; proposals?: Omit<ProposalsEvaluateDeps, "logger"> };

export async function registerHandlers(queue: Queue, logger: Logger, deps: WorkerDeps = {}): Promise<void> {
  await queue.work("health.ping", async ({ message }) => {
    logger.info({ message }, "health.ping processed");
  });

  // Suggestions follow the data they are made from: after a sync, a check, or a link check, ask for an evaluation of what changed.
  // The job is only ids, and a queue that is down must never fail the job that already finished.
  const evaluateAfter = async (scope: { supplierId?: string; mappingId?: string }) => {
    if (!deps.proposals) return;
    try {
      await queue.enqueue("proposals.evaluate", scope);
    } catch {
      logger.warn("could not queue a suggestions evaluation");
    }
  };

  if (deps.proposals) {
    const evaluate = createProposalsEvaluateHandler({ ...deps.proposals, logger });
    await queue.work("proposals.evaluate", async (payload) => void (await evaluate(payload)));
  }

  if (deps.shopify) {
    const handle = createShopifySyncHandler({ ...deps.shopify, logger });
    await queue.work("shopify.sync", async (payload) => {
      await handle(payload);
      await evaluateAfter({});
    });
  }

  if (deps.supplierVerify) {
    const handle = createSupplierVerifyHandler({ ...deps.supplierVerify, logger });
    await queue.work("supplier.session.verify", async (payload) => handle(payload));
  }

  if (deps.mappingLinks) {
    const handlers = createLinkCheckHandlers({ ...deps.mappingLinks, logger });
    await queue.work("mapping.link.check", async (payload) => {
      await handlers.link(payload);
      await evaluateAfter({ mappingId: payload.mappingId });
    });
    await queue.work("mapping.links.check", async (payload) => {
      await handlers.links(payload);
      await evaluateAfter({ supplierId: payload.supplierId });
    });
  }

  if (deps.extractionCapture) {
    const handle = createCaptureHandler({ ...deps.extractionCapture, logger });
    await queue.work("extraction.capture", async (payload) => handle(payload));
  }

  if (deps.extractionChecks) {
    const handlers = createStockCheckHandlers({ ...deps.extractionChecks, logger });
    await queue.work("extraction.check", async (payload) => {
      await handlers.one(payload);
      await evaluateAfter({ mappingId: payload.mappingId });
    });
    await queue.work("extraction.checks", async (payload) => {
      await handlers.many(payload);
      await evaluateAfter({ supplierId: payload.supplierId });
    });
  }

  if (deps.scheduling) {
    const tick = { ...deps.scheduling, logger };
    await reapStaleRuns(tick); // nothing is running any more after a restart
    await queue.work("scheduling.tick", async () => {
      const result = await runTick(tick);
      if (result.started.length > 0) logger.info({ started: result.started.length }, "scheduled runs started");
    });
    await queue.schedule("scheduling.tick", "* * * * *");
  }
}
