import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createMappingRepository, createObservationRepository, createRecipeRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { whyNotChecked } from "@stock-monitor/mapping";
import type { Queue } from "@stock-monitor/queue";
import { AppError } from "../errors.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;
type Audit = ReturnType<typeof createAuditWriter>;

export type StockCheckRoutesDeps = {
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  recipes: ReturnType<typeof createRecipeRepository>;
  observations: ReturnType<typeof createObservationRepository>;
  queue: Pick<Queue, "enqueue">;
};

// A run waits the supplier's pause between pages, so it can take far longer than the queue's default 15 minutes. If the queue gave
// up on it half way it would start the whole run again at the same time as the first.
const RUN_MIN_SECONDS = 15 * 60;
const RUN_MAX_SECONDS = 6 * 60 * 60;
const PER_PAGE_EXTRA_SECONDS = 30;
const NOT_STARTED = () => new AppError(503, "check_not_started", "The check could not be started. Please try again in a minute.");

/** Stock checks on request, and what they found. The checks themselves run in the worker. */
export function registerStockCheckRoutes(app: App, deps: StockCheckRoutesDeps, audit: Audit): void {
  const { mappings, suppliers, supplierSessions, recipes, observations, queue } = deps;
  const record = (request: { user: { id: string } | null; id: string }, action: string, entityType: string, id: string, details?: Record<string, unknown>) =>
    audit.record({ actorUserId: request.user?.id, action, entityType, entityId: id, details, requestId: request.id });

  /** A supplier whose stock may be checked now, or the plain reason it may not. */
  async function readySupplier(supplierId: string) {
    const supplier = await suppliers.get(supplierId);
    if (!supplier) throw new AppError(404, "supplier_not_found", "That supplier does not exist.");
    const refused = whyNotChecked(supplier, (await supplierSessions.getSealed(supplierId)) !== null);
    if (refused) throw new AppError(409, refused.reason, refused.message);
    if (!(await recipes.active(supplierId))) throw new AppError(409, "no_recipe", "Turn on stock rules for this supplier first.");
    return supplier;
  }

  app.post<{ Params: { id: string } }>("/api/mappings/:id/check-stock", async (request, reply) => {
    const mapping = await mappings.get(request.params.id);
    if (!mapping) throw new AppError(404, "mapping_not_found", "That link does not exist.");
    if (!mapping.enabled) throw new AppError(409, "link_off", "This link is switched off. Switch it on to check it.");
    await readySupplier(mapping.supplierId);
    try {
      await queue.enqueue("extraction.check", { mappingId: mapping.id });
    } catch {
      throw NOT_STARTED();
    }
    await record(request, "mapping.stock_check_requested", "mapping", mapping.id);
    return reply.status(202).send({ queued: true });
  });

  app.post<{ Params: { id: string } }>("/api/suppliers/:id/check-stock", async (request, reply) => {
    const supplier = await readySupplier(request.params.id);
    const links = (await mappings.forSupplier(supplier.id)).filter((m) => m.enabled).length;
    if (links === 0) throw new AppError(409, "no_links", "This supplier has no links to check yet.");
    const seconds = links * (supplier.checkPauseSeconds + PER_PAGE_EXTRA_SECONDS);
    try {
      await queue.enqueue("extraction.checks", { supplierId: supplier.id }, { expireInSeconds: Math.min(RUN_MAX_SECONDS, Math.max(RUN_MIN_SECONDS, seconds)), retryLimit: 0 });
    } catch {
      throw NOT_STARTED();
    }
    await record(request, "mapping.supplier_stock_check_requested", "supplier", supplier.id, { links });
    return reply.status(202).send({ queued: true, links });
  });

  app.get<{ Params: { id: string } }>("/api/mappings/:id/observations", async (request) => {
    if (!(await mappings.get(request.params.id))) throw new AppError(404, "mapping_not_found", "That link does not exist.");
    return { observations: await observations.listFor(request.params.id) };
  });
}
