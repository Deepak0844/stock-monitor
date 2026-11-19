import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createCheckRunRepository, createMappingRepository, createNotificationRepository, createProposalRepository, createRecipeRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import type { Queue } from "@stock-monitor/queue";
import { keepAliveDue, needsSessionPrecheck, pickDue, runExpirySeconds } from "@stock-monitor/scheduling";
import { whyNotChecked } from "@stock-monitor/mapping";
import { stockGate, type SkipReason } from "./extraction-check.js";
import { sendLoginAlerts, type SendMail } from "./alert-email.js";

export type TickDeps = {
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  recipes: ReturnType<typeof createRecipeRepository>;
  mappings: ReturnType<typeof createMappingRepository>;
  checkRuns: ReturnType<typeof createCheckRunRepository>;
  /** When set, open suggestions past their time are expired on every tick. */
  proposals?: ReturnType<typeof createProposalRepository>;
  queue: Pick<Queue, "enqueue">;
  audit: ReturnType<typeof createAuditWriter>;
  logger: Logger;
  /** The owner's timezone, for each supplier's quiet-hours window. */
  timezone: string;
  /** When set, each new login notice is emailed once. The link in the email points at `appOrigin`. */
  alerts?: { notifications: ReturnType<typeof createNotificationRepository>; send: SendMail; appOrigin: string | undefined };
  now?: () => Date;
};

/** At most this many suppliers are checked at the same time: each live page costs the browser service memory. */
export const MAX_RUNS_AT_ONCE = 2;
// A run is stopped if it has gone longer than the queue allows (6 hours) plus a margin, so a lost job cannot hold a supplier forever.
const STUCK_AFTER_SECONDS = 6 * 3600 + 5 * 60;
const KEEP_RUNS_DAYS = 30;
const STUCK_APPROVED_MS = 15 * 60_000;
const RUN_SOON_MS = 5 * 60_000;

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
  if (deps.proposals) {
    await deps.proposals.expireDue(now);
    // An approved suggestion that nobody finished (a lost job, a crash, a queue that was down) is applied again. The stored key makes that safe.
    for (const proposalId of await deps.proposals.stuckApproved(new Date(now.getTime() - STUCK_APPROVED_MS))) {
      await queue.enqueue("proposals.apply", { proposalId }, { retryLimit: 0 }).catch(() => logger.warn({ proposalId }, "could not queue a stuck suggestion"));
    }
  }

  const going = await checkRuns.running();
  const busy = new Set(going.map((r) => r.supplierId));
  const skipped: { supplierId: string; reason: SkipReason }[] = [];
  const candidates = [];
  const prechecked = new Set<string>();
  for (const supplier of await suppliers.scheduled()) {
    if (busy.has(supplier.id)) continue; // already being checked: it must not use up a place meant for another supplier
    const gated = await stockGate(deps, supplier.id);
    if ("reason" in gated) {
      skipped.push({ supplierId: supplier.id, reason: gated.reason });
      continue;
    }
    const window = supplier.scheduleWindowStart && supplier.scheduleWindowEnd ? { start: supplier.scheduleWindowStart, end: supplier.scheduleWindowEnd } : null;
    if (await precheckLogin(deps, supplier, window, now)) prechecked.add(supplier.id);
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
  await keepLoginsAlive(deps, now, new Set([...busy, ...started, ...prechecked]));
  // Email must never fail the tick: its runs have already started.
  if (deps.alerts) await sendLoginAlerts({ ...deps.alerts, logger }).catch(() => logger.warn("login alert emails could not be checked"));
  return { started, skipped };
}

/**
 * Visits each supplier with keep-alive on, inside its window, so an idle supplier does not log the session out. Never one
 * that is being checked or the gate refuses. The next visit time is written first: a visit that cannot reach the supplier
 * must not be queued again on every tick.
 */
async function keepLoginsAlive(deps: TickDeps, now: Date, busy: Set<string>) {
  for (const supplier of await deps.suppliers.keepingAlive()) {
    if (busy.has(supplier.id) || !supplier.keepAliveMinutes) continue;
    // A run about to start would find its browser profile held by the visit. The run keeps the login alive anyway.
    const runSoon = supplier.scheduleIntervalMinutes && supplier.nextCheckAt && supplier.nextCheckAt > now && supplier.nextCheckAt.getTime() - now.getTime() <= RUN_SOON_MS;
    if (runSoon) continue;
    if (whyNotChecked(supplier, (await deps.supplierSessions.getSealed(supplier.id)) !== null)) continue;
    const window = supplier.scheduleWindowStart && supplier.scheduleWindowEnd ? { start: supplier.scheduleWindowStart, end: supplier.scheduleWindowEnd } : null;
    const lastVerifiedAt = (await deps.supplierSessions.facts(supplier.id))?.lastVerifiedAt ?? null;
    const next = keepAliveDue({ now, minutes: supplier.keepAliveMinutes, nextAt: supplier.keepAliveNextAt, lastVerifiedAt, window, timeZone: deps.timezone });
    if (next.nextAt.getTime() !== supplier.keepAliveNextAt?.getTime()) await deps.suppliers.setKeepAliveNext(supplier.id, next.nextAt);
    if (!next.due) continue;
    await deps.queue.enqueue("supplier.session.verify", { supplierId: supplier.id, keepAlive: true }, { retryLimit: 0 }).catch(() => deps.logger.warn({ supplierId: supplier.id }, "keep-alive visit could not be queued"));
  }
}

/**
 * Queues one check of the supplier's login ahead of its next run, so the owner can log in again before the run starts. The
 * run it was queued for is recorded first: a check that cannot reach the supplier proves nothing, and must not be queued
 * again on every tick. True when it was queued.
 */
async function precheckLogin(
  deps: TickDeps,
  supplier: { id: string; nextCheckAt: Date | null; sessionPrecheckFor: Date | null; autoLogin: boolean; autoLoginPausedReason: string | null; needsLogin: boolean },
  window: { start: string; end: string } | null,
  now: Date,
) {
  // No login to check.
  if (!supplier.needsLogin) return false;
  // The run logs in by itself, and a login two hours early would not last until the run anyway.
  if (supplier.autoLogin && !supplier.autoLoginPausedReason) return false;
  const lastVerifiedAt = (await deps.supplierSessions.facts(supplier.id))?.lastVerifiedAt ?? null;
  if (!needsSessionPrecheck({ now, nextCheckAt: supplier.nextCheckAt, window, lastVerifiedAt, precheckFor: supplier.sessionPrecheckFor }, deps.timezone)) return false;
  await deps.suppliers.markPrecheckQueued(supplier.id, supplier.nextCheckAt as Date);
  await deps.queue.enqueue("supplier.session.verify", { supplierId: supplier.id, early: true }, { retryLimit: 0 }).catch(() => deps.logger.warn({ supplierId: supplier.id }, "early login check could not be queued"));
  return true;
}

/** At start-up nothing is running any more, so every run still marked running is stopped. */
export async function reapStaleRuns(deps: Pick<TickDeps, "checkRuns" | "audit" | "logger">): Promise<number> {
  const count = await deps.checkRuns.stopAllRunning("restarted");
  if (count > 0) deps.logger.info({ count }, "stopped runs left over from before the restart");
  return count;
}
