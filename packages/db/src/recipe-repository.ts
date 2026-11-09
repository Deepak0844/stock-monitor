import { desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { stockRecipes } from "./schema.js";

export type RecipeRecord = { id: string; supplierId: string; version: number; rules: unknown; active: boolean; createdAt: Date; activatedAt: Date | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRecipeRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  const get = async (id: string): Promise<RecipeRecord | null> => {
    if (!UUID.test(id)) return null;
    const [row] = await db.select().from(stockRecipes).where(eq(stockRecipes.id, id)).limit(1);
    return (row as RecipeRecord | undefined) ?? null;
  };
  return {
    get,

    /** Saves rules as the supplier's next version. A recipe is never edited. The caller has already validated the rules. */
    async create(supplierId: string, rules: unknown): Promise<{ id: string; version: number }> {
      // A concurrent save would pick the same number: the unique index refuses it, and the caller can try again.
      const [row] = await db
        .insert(stockRecipes)
        .values({ supplierId, rules, version: sql`(select coalesce(max(version), 0) + 1 from stock_recipes where supplier_id = ${supplierId})` })
        .returning({ id: stockRecipes.id, version: stockRecipes.version });
      return row as { id: string; version: number };
    },

    async list(supplierId: string): Promise<RecipeRecord[]> {
      if (!UUID.test(supplierId)) return [];
      return (await db.select().from(stockRecipes).where(eq(stockRecipes.supplierId, supplierId)).orderBy(desc(stockRecipes.version))) as RecipeRecord[];
    },

    async active(supplierId: string): Promise<RecipeRecord | null> {
      if (!UUID.test(supplierId)) return null;
      const [row] = await db.select().from(stockRecipes).where(sql`${stockRecipes.supplierId} = ${supplierId} and ${stockRecipes.active}`).limit(1);
      return (row as RecipeRecord | undefined) ?? null;
    },

    /** Turns one version on and the supplier's other versions off, in one step. */
    async activate(id: string): Promise<RecipeRecord | null> {
      const recipe = await get(id);
      if (!recipe) return null;
      await db.transaction(async (tx) => {
        await tx.update(stockRecipes).set({ active: false }).where(sql`${stockRecipes.supplierId} = ${recipe.supplierId} and ${stockRecipes.active}`);
        await tx.update(stockRecipes).set({ active: true, activatedAt: new Date() }).where(eq(stockRecipes.id, id));
      });
      return get(id);
    },
  };
}
