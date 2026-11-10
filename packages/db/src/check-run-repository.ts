import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { checkRuns } from "./schema.js";

export type CheckRun = {
  id: string;
  supplierId: string;
  trigger: "scheduled" | "manual";
  startedAt: Date;
  endedAt: Date | null;
  linksTotal: number;
  linksDone: number;
  inStock: number;
  outOfStock: number;
  cannotTell: number;
  outcome: "running" | "finished" | "stopped" | "failed";
  stopReason: string | null;
};
export type RunCounts = { linksDone: number; inStock: number; outOfStock: number; cannotTell: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";
const isTaken = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === UNIQUE_VIOLATION;
};

export function createCheckRunRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  return {
    /** Starts a run, or returns null when this supplier already has one running. */
    async start(supplierId: string, trigger: CheckRun["trigger"], linksTotal: number): Promise<CheckRun | null> {
      if (!UUID.test(supplierId)) return null;
      try {
        const [row] = await db.insert(checkRuns).values({ supplierId, trigger, linksTotal }).returning();
        return row as CheckRun;
      } catch (error) {
        if (isTaken(error)) return null;
        throw error;
      }
    },

    async progress(id: string, counts: RunCounts): Promise<void> {
      await db.update(checkRuns).set(counts).where(eq(checkRuns.id, id));
    },

    async end(id: string, outcome: Exclude<CheckRun["outcome"], "running">, stopReason: string | null): Promise<void> {
      await db.update(checkRuns).set({ outcome, stopReason, endedAt: new Date() }).where(and(eq(checkRuns.id, id), eq(checkRuns.outcome, "running")));
    },

    /** Whether this run is still marked running. A job that starts after a restart ended its run must not do the work. */
    async isRunning(id: string): Promise<boolean> {
      if (!UUID.test(id)) return false;
      const [row] = await db.select({ id: checkRuns.id }).from(checkRuns).where(and(eq(checkRuns.id, id), eq(checkRuns.outcome, "running"))).limit(1);
      return Boolean(row);
    },

    async running(): Promise<CheckRun[]> {
      return (await db.select().from(checkRuns).where(eq(checkRuns.outcome, "running"))) as CheckRun[];
    },

    async current(supplierId: string): Promise<CheckRun | null> {
      if (!UUID.test(supplierId)) return null;
      const [row] = await db.select().from(checkRuns).where(and(eq(checkRuns.supplierId, supplierId), eq(checkRuns.outcome, "running"))).limit(1);
      return (row as CheckRun | undefined) ?? null;
    },

    /** The most recent runs of the last 30 days, newest first. */
    async recent(supplierId: string, limit: number): Promise<CheckRun[]> {
      if (!UUID.test(supplierId)) return [];
      return (await db
        .select()
        .from(checkRuns)
        .where(and(eq(checkRuns.supplierId, supplierId), gte(checkRuns.startedAt, sql`now() - interval '30 days'`)))
        .orderBy(desc(checkRuns.startedAt))
        .limit(limit)) as CheckRun[];
    },

    /** For a restart: nothing is running any more, so every running row is stopped. */
    async stopAllRunning(reason: string): Promise<number> {
      const rows = await db.update(checkRuns).set({ outcome: "stopped", stopReason: reason, endedAt: new Date() }).where(eq(checkRuns.outcome, "running")).returning({ id: checkRuns.id });
      return rows.length;
    },

    /** Stops runs that have been going longer than the queue would let them. Returns how many. */
    async stopOlderThan(seconds: number, reason: string): Promise<number> {
      const rows = await db
        .update(checkRuns)
        .set({ outcome: "stopped", stopReason: reason, endedAt: new Date() })
        .where(and(eq(checkRuns.outcome, "running"), lt(checkRuns.startedAt, sql`now() - make_interval(secs => ${seconds})`)))
        .returning({ id: checkRuns.id });
      return rows.length;
    },

    async purge(days: number): Promise<number> {
      const rows = await db.delete(checkRuns).where(lt(checkRuns.startedAt, sql`now() - make_interval(days => ${days})`)).returning({ id: checkRuns.id });
      return rows.length;
    },
  };
}
