import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { CheckRun, createCheckRunRepository, createRecipeRepository, createSupplierRepository, createSupplierSessionRepository, SupplierRecord } from "@stock-monitor/db";
import { whyNotChecked, type CheckGateReason } from "@stock-monitor/mapping";
import { INTERVALS, nextCheckAt, type Window } from "@stock-monitor/scheduling";
import { AppError } from "../errors.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;
type Audit = ReturnType<typeof createAuditWriter>;

export type ScheduleRoutesDeps = {
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  recipes: ReturnType<typeof createRecipeRepository>;
  checkRuns: ReturnType<typeof createCheckRunRepository>;
  /** The owner's timezone: the quiet-hours window is in this zone. */
  timezone: string;
  now?: () => Date;
  /** For the spread added to the next check time. Tests fix it. */
  random?: () => number;
};

export type ScheduleStatus =
  | { state: "off" | "waiting" | "running" }
  | { state: "not_checked"; reason: CheckGateReason | "no_recipe"; message: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const INVALID = () => new AppError(400, "invalid_schedule", "Choose how often to check, and a start and end time that are different.");
const NOT_FOUND = () => new AppError(404, "supplier_not_found", "That supplier does not exist.");
const NO_RECIPE = "Turn on stock rules for this supplier first.";

/** The body of PUT /schedule: an interval from the list or null (off), and a window or null (all day). Nothing else. */
function readSchedule(body: unknown): { intervalMinutes: number | null; window: Window } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw INVALID();
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((k) => k !== "intervalMinutes" && k !== "window")) throw INVALID();
  const interval = input.intervalMinutes;
  if (interval !== null && !(typeof interval === "number" && (INTERVALS as readonly number[]).includes(interval))) throw INVALID();
  const w = input.window;
  if (w === null) return { intervalMinutes: interval, window: null };
  if (typeof w !== "object" || w === undefined || Array.isArray(w)) throw INVALID();
  const { start, end, ...rest } = w as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof start !== "string" || typeof end !== "string" || !TIME.test(start) || !TIME.test(end) || start === end) throw INVALID();
  return { intervalMinutes: interval, window: { start, end } };
}

const windowOf = (s: SupplierRecord): Window => (s.scheduleWindowStart && s.scheduleWindowEnd ? { start: s.scheduleWindowStart, end: s.scheduleWindowEnd } : null);

/** Automatic checks: the setting, what the schedule is doing for each supplier, and the history of runs. The runs themselves happen in the worker. */
export function registerScheduleRoutes(app: App, deps: ScheduleRoutesDeps, audit: Audit): void {
  const { suppliers, supplierSessions, recipes, checkRuns } = deps;
  const now = deps.now ?? (() => new Date());

  async function status(s: SupplierRecord, running: CheckRun | null): Promise<ScheduleStatus> {
    if (!s.scheduleIntervalMinutes) return { state: "off" };
    if (running) return { state: "running" };
    const refused = whyNotChecked(s, (await supplierSessions.getSealed(s.id)) !== null);
    if (refused) return { state: "not_checked", reason: refused.reason, message: refused.message };
    if (!(await recipes.active(s.id))) return { state: "not_checked", reason: "no_recipe", message: NO_RECIPE };
    return { state: "waiting" };
  }

  app.put<{ Params: { id: string } }>("/api/suppliers/:id/schedule", async (request) => {
    const { intervalMinutes, window } = readSchedule(request.body);
    const next = intervalMinutes ? nextCheckAt(now(), intervalMinutes, window, deps.timezone, deps.random) : null;
    const supplier = await suppliers.setSchedule(request.params.id, { intervalMinutes, window, nextCheckAt: next });
    if (!supplier) throw NOT_FOUND();
    await audit.record({ actorUserId: request.user?.id, action: "supplier.schedule_set", entityType: "supplier", entityId: supplier.id, details: { intervalMinutes, window }, requestId: request.id });
    return { supplier };
  });

  app.get("/api/schedule", async () => {
    const schedule = [];
    for (const s of await suppliers.list()) {
      const run = await checkRuns.current(s.id);
      const lastRun = (await checkRuns.recent(s.id, 2)).find((r) => r.endedAt) ?? null;
      schedule.push({ supplierId: s.id, status: await status(s, run), intervalMinutes: s.scheduleIntervalMinutes, window: windowOf(s), nextCheckAt: s.nextCheckAt, run, lastRun });
    }
    return { schedule };
  });

  app.get<{ Params: { id: string } }>("/api/suppliers/:id/runs", async (request) => {
    if (!(await suppliers.get(request.params.id))) throw NOT_FOUND();
    return { runs: await checkRuns.recent(request.params.id, 30) };
  });

  app.get<{ Params: { id: string } }>("/api/suppliers/:id/runs/current", async (request) => {
    if (!(await suppliers.get(request.params.id))) throw NOT_FOUND();
    return { run: await checkRuns.current(request.params.id) };
  });
}
