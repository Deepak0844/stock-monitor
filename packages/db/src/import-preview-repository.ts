import { eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { importPreviews } from "./schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createImportPreviewRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  return {
    async save(rows: unknown[]): Promise<string> {
      const [row] = await db.insert(importPreviews).values({ rows }).returning({ id: importPreviews.id });
      return (row as { id: string }).id;
    },

    /** Gives the rows back and deletes them in one step, so a preview can be confirmed only once. */
    async take(id: string): Promise<unknown[] | null> {
      if (!UUID.test(id)) return null;
      const [row] = await db.delete(importPreviews).where(eq(importPreviews.id, id)).returning({ rows: importPreviews.rows });
      return (row?.rows as unknown[] | undefined) ?? null;
    },

    async purgeOlderThan(minutes: number): Promise<void> {
      await db.delete(importPreviews).where(lt(importPreviews.createdAt, sql`now() - make_interval(mins => ${minutes})`));
    },
  };
}
