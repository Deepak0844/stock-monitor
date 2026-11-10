import { desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { stockObservations } from "./schema.js";

export type StockAnswer = "in_stock" | "out_of_stock" | "cannot_tell";
export type ObservationInput = {
  mappingId: string;
  answer: StockAnswer;
  reason: string | null;
  quantity: number | null;
  /** The one short line that decided it, never more of the page. */
  matchedText: string | null;
  quantityMismatch: boolean;
  recipeVersion: number | null;
  /** What the visit found: ok, needs_login, blocked, unreachable... */
  checkResult: string;
  captureId: string | null;
};
export type ObservationRecord = ObservationInput & { id: number; observedAt: Date };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createObservationRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  return {
    async append(input: ObservationInput): Promise<void> {
      await db.insert(stockObservations).values(input);
    },

    /** One link's history, newest first. */
    async listFor(mappingId: string, limit = 100): Promise<ObservationRecord[]> {
      if (!UUID.test(mappingId)) return [];
      return (await db.select().from(stockObservations).where(eq(stockObservations.mappingId, mappingId)).orderBy(desc(stockObservations.id)).limit(limit)) as ObservationRecord[];
    },

    /** The newest observation of every link that has one. */
    async latestByMapping(): Promise<Map<string, ObservationRecord>> {
      const rows = (await db.execute(
        sql`select distinct on (mapping_id) id, mapping_id as "mappingId", observed_at as "observedAt", answer, reason, quantity, matched_text as "matchedText", quantity_mismatch as "quantityMismatch", recipe_version as "recipeVersion", check_result as "checkResult", capture_id as "captureId" from stock_observations order by mapping_id, id desc`,
      )) as unknown as { rows: ObservationRecord[] };
      return new Map(rows.rows.map((r) => [r.mappingId, r]));
    },
  };
}
