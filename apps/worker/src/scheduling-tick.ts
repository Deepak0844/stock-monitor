import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createCheckRunRepository, createMappingRepository, createRecipeRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import type { Queue } from "@stock-monitor/queue";
import { pickDue, runExpirySeconds } from "@stock-monitor/scheduling";
import { stockGate, type SkipReason } from "./extraction-check.js";

export type TickDeps = {
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  recipes: ReturnType<typeof createRecipeRepository>;
  mappings: ReturnType<typeof createMappingRepository>;
  checkRuns: ReturnType<typeof createCheckRunRepository>;
  queue: Pick<Queue, "enqueue">;
  audit: ReturnType<typeof createAuditWriter>;
  logger: Logger;
  /** The owner's timezone, for each supplier's quiet-hours window. */
  timezone: string;
  now?: () => Date;
};

/** At most this many suppliers are checked at the same time: each live page costs the browser service memory. */
export const MAX_RUNS_AT_ONCE = 2;
// A run is stopped if it has gone longer than the queue allows (6 hours) plus a margin, so a lost job cannot hold a supplier forever.
const STUCK_AFTER_SECONDS = 6 * 3600 + 5 * 60;
const KEEP_RUNS_DAYS = 30;

/**
 * Starts the supplier runs that are due. Every minute. It uses the same gate as the checker, so a supplier that is paused, not
 * connected, not allowed or without rules is never visited and its next check is not moved: it is picked up when it is ready again.
 * A run is made as a record first (the database refuses a second running one for the supplier), then queued with only its ids.
 */
export async function runTick(deps: TickDeps): Promise<{ started: string[]; skipped: { supplierId: string; reason: SkipReason }[] }> {
  const { suppliers, mappings, checkRuns, queue, audit, logger } = deps;
  const now = (deps.now ?? (() => new Date()))();
  await checkRuns.stopOlderThan(STUCK_AFTER_SECONDS, "expired");
  await checkRuns.purge(KEEP_RUNS_DAYS);

  const going = await checkRuns.running();
  const busy = new Set(going.map((r) => r.supplierId));
  const skipped: { supplierId: string; reason: SkipReason }[] = [];
  const candidates = [];
  for (const supplier of await suppliers.scheduled()) {
    if (busy.has(supplier.id)) continue; // already being checked: it must not use up a place meant for another supplier
    const gated = await stockGate(deps, supplier.id);
    if ("reason" in gated) {
      skipped.push({ supplierId: supplier.id, reason: gated.reason });
      continue;
    }
    const window = supplier.scheduleWindowStart && supplier.scheduleWindowEnd ? { start: supplier.scheduleWindowStart, end: supplier.scheduleWindowEnd } : null;
    candidates.push({ id: supplier.id, nextCheckAt: supplier.nextCheckAt ?? now, window, pause: supplier.checkPauseSeconds });
  }

  const running = going.length;
  const started: string[] = [];
  for (const id of pickDue(candidates, now, running, MAX_RUNS_AT_ONCE, deps.timezone)) {
    const links = (await mappings.forSupplier(id)).filter((m) => m.enabled).length;
    const run = await checkRuns.start(id, "scheduled", links);
    if (!run) continue; // another tick or the owner's button got there first
    const pause = candidates.find((c) => c.id === id)?.pause ?? 10;
    try {
      await queue.enqueue("extraction.checks", { supplierId: id, runId: run.id }, { expireInSeconds: runExpirySeconds(links, pause), retryLimit: 0 });
    } catch {
      await checkRuns.end(run.id, "failed", "not_queued");
      logger.warn({ supplierId: id }, "scheduled run could not be queued");
      continue;
    }
    await audit.record({ action: "check_run.started", entityType: "supplier", entityId: id, details: { runId: run.id, trigger: "scheduled", links } });
    started.push(id);
  }
  return { started, skipped };
}

/** At start-up nothing is running any more, so every run still marked running is stopped. */
export async function reapStaleRuns(deps: Pick<TickDeps, "checkRuns" | "audit" | "logger">): Promise<number> {
  const count = await deps.checkRuns.stopAllRunning("restarted");
  if (count > 0) deps.logger.info({ count }, "stopped runs left over from before the restart");
  return count;
}
