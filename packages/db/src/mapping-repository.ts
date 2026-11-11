import { and, asc, count, eq, ilike, isNull, notExists, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { mappings, shopifyVariants, suppliers } from "./schema.js";

export type LinkStatusValue = "not_checked" | "works" | "never_worked" | "page_missing" | "moved" | "looks_different" | "needs_login" | "could_not_check";

export type MappingRecord = {
  id: string;
  variantId: string;
  supplierId: string;
  url: string;
  note: string | null;
  /** The region label to look for on this page. null means the supplier's default region. */
  region: string | null;
  enabled: boolean;
  linkStatus: LinkStatusValue;
  lastLinkCheckAt: Date | null;
  lastWorkedAt: Date | null;
  workedTitle: string | null;
  workedHeading: string | null;
  missingChecks: number;
  firstMissingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
/** `shopifyManaged`: the variant's product has a supplier name and page address in Shopify, so the next sync sets this link from them. */
export type MappingRow = MappingRecord & { productTitle: string; variantTitle: string; sku: string | null; supplierName: string; variantRemoved: boolean; shopifyManaged: boolean };
export type MappingInput = { variantId: string; supplierId: string; url: string; note: string | null; region?: string | null };
export type MappingWrite = { ok: true; mapping: MappingRecord } | { ok: false; reason: "duplicate" | "unknown_variant" | "unknown_supplier" };
/** What a link check decided. Matches the link-status rules in the mapping package. */
export type LinkCheckResult = {
  status: LinkStatusValue;
  lastWorkedAt: Date | null;
  workedTitle: string | null;
  workedHeading: string | null;
  missingChecks: number;
  firstMissingAt: Date | null;
  checkedAt: Date | null;
};
export type MappingFilter = { supplierId?: string; linkStatus?: LinkStatusValue; search?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";
const isUnique = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === UNIQUE_VIOLATION;
};
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

// Back to "not checked": a new address has no history.
const RESET = {
  linkStatus: "not_checked",
  lastLinkCheckAt: null,
  lastWorkedAt: null,
  workedTitle: null,
  workedHeading: null,
  missingChecks: 0,
  firstMissingAt: null,
} as const;

export function createMappingRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  const joined = () =>
    db
      .select({
        id: mappings.id, variantId: mappings.variantId, supplierId: mappings.supplierId, url: mappings.url, note: mappings.note, region: mappings.region,
        enabled: mappings.enabled, linkStatus: mappings.linkStatus, lastLinkCheckAt: mappings.lastLinkCheckAt,
        lastWorkedAt: mappings.lastWorkedAt, workedTitle: mappings.workedTitle, workedHeading: mappings.workedHeading,
        missingChecks: mappings.missingChecks, firstMissingAt: mappings.firstMissingAt, createdAt: mappings.createdAt, updatedAt: mappings.updatedAt,
        productTitle: shopifyVariants.productTitle, variantTitle: shopifyVariants.variantTitle, sku: shopifyVariants.sku,
        supplierName: suppliers.name, variantRemoved: sql<boolean>`${shopifyVariants.removedAt} is not null`,
        shopifyManaged: sql<boolean>`(${shopifyVariants.supplierName} is not null and ${shopifyVariants.supplierUrl} is not null and ${shopifyVariants.removedAt} is null)`,
      })
      .from(mappings)
      .innerJoin(shopifyVariants, eq(shopifyVariants.variantId, mappings.variantId))
      .innerJoin(suppliers, eq(suppliers.id, mappings.supplierId));

  const search = (text: string): SQL | undefined => {
    const like = `%${escapeLike(text.trim())}%`;
    return text.trim() ? or(ilike(shopifyVariants.productTitle, like), ilike(shopifyVariants.variantTitle, like), ilike(shopifyVariants.sku, like)) : undefined;
  };

  const whereFor = (filter: MappingFilter) =>
    and(
      filter.supplierId ? eq(mappings.supplierId, filter.supplierId) : undefined,
      filter.linkStatus ? eq(mappings.linkStatus, filter.linkStatus) : undefined,
      filter.search ? search(filter.search) : undefined,
    );

  const get = async (id: string): Promise<MappingRow | null> => {
    if (!UUID.test(id)) return null;
    const [row] = await joined().where(eq(mappings.id, id)).limit(1);
    return (row as MappingRow | undefined) ?? null;
  };

  return {
    get,

    async list(filter: MappingFilter): Promise<MappingRow[]> {
      if (filter.supplierId !== undefined && !UUID.test(filter.supplierId)) return [];
      const where = whereFor(filter);
      return (await joined().where(where).orderBy(asc(shopifyVariants.productTitle), asc(shopifyVariants.variantTitle))) as MappingRow[];
    },

    /** One page of links in the same order as `list`, with how many match in all. */
    async page(filter: MappingFilter & { page: number; pageSize: number }): Promise<{ rows: MappingRow[]; total: number }> {
      if (filter.supplierId !== undefined && !UUID.test(filter.supplierId)) return { rows: [], total: 0 };
      const where = whereFor(filter);
      const rows = (await joined()
        .where(where)
        .orderBy(asc(shopifyVariants.productTitle), asc(shopifyVariants.variantTitle), asc(mappings.id))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize)) as MappingRow[];
      const [row] = await db
        .select({ n: count() })
        .from(mappings)
        .innerJoin(shopifyVariants, eq(shopifyVariants.variantId, mappings.variantId))
        .innerJoin(suppliers, eq(suppliers.id, mappings.supplierId))
        .where(where);
      return { rows, total: Number(row?.n ?? 0) };
    },

    async forSupplier(supplierId: string): Promise<MappingRow[]> {
      return this.list({ supplierId });
    },

    async create(input: MappingInput): Promise<MappingWrite> {
      if (!UUID.test(input.supplierId) || !(await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1)).length) {
        return { ok: false, reason: "unknown_supplier" };
      }
      if (!(await db.select({ id: shopifyVariants.variantId }).from(shopifyVariants).where(eq(shopifyVariants.variantId, input.variantId)).limit(1)).length) {
        return { ok: false, reason: "unknown_variant" };
      }
      try {
        const [row] = await db.insert(mappings).values(input).returning();
        return { ok: true, mapping: row as MappingRecord };
      } catch (error) {
        if (isUnique(error)) return { ok: false, reason: "duplicate" };
        throw error;
      }
    },

    /** Changing the address starts the link's history again. Changing only the note or `enabled` does not. */
    async update(id: string, patch: { url?: string; note?: string | null; region?: string | null; enabled?: boolean }): Promise<MappingRecord | null> {
      if (!UUID.test(id)) return null;
      const [row] = await db
        .update(mappings)
        .set({ ...patch, ...(patch.url !== undefined ? { ...RESET } : {}), updatedAt: new Date() })
        .where(eq(mappings.id, id))
        .returning();
      return (row as MappingRecord | undefined) ?? null;
    },

    async remove(id: string): Promise<boolean> {
      if (!UUID.test(id)) return false;
      return (await db.delete(mappings).where(eq(mappings.id, id)).returning({ id: mappings.id })).length > 0;
    },

    /** Saves what a link check decided. */
    async recordCheck(id: string, result: LinkCheckResult): Promise<void> {
      if (!UUID.test(id)) return;
      await db
        .update(mappings)
        .set({
          linkStatus: result.status, lastLinkCheckAt: result.checkedAt, lastWorkedAt: result.lastWorkedAt,
          workedTitle: result.workedTitle, workedHeading: result.workedHeading, missingChecks: result.missingChecks,
          firstMissingAt: result.firstMissingAt, updatedAt: new Date(),
        })
        .where(eq(mappings.id, id));
    },

    /**
     * Saves confirmed import rows. The same rows again change nothing. A changed address replaces the old one and
     * starts the history again. Rows are saved one at a time inside one transaction.
     * shortcut: one query per row, fine for the 20,000-row limit, batch it if imports get slow.
     */
    async upsertMany(rows: { variantId: string; supplierId: string; url: string }[]): Promise<{ created: number; updated: number; unchanged: number }> {
      const result = { created: 0, updated: 0, unchanged: 0 };
      await db.transaction(async (tx) => {
        for (const row of rows) {
          const [current] = await tx
            .select({ id: mappings.id, url: mappings.url })
            .from(mappings)
            .where(and(eq(mappings.variantId, row.variantId), eq(mappings.supplierId, row.supplierId)))
            .limit(1);
          if (!current) {
            await tx.insert(mappings).values(row);
            result.created++;
          } else if (current.url === row.url) {
            result.unchanged++;
          } else {
            await tx.update(mappings).set({ url: row.url, ...RESET, updatedAt: new Date() }).where(eq(mappings.id, current.id));
            result.updated++;
          }
        }
      });
      return result;
    },

    /** Live variants whose product has both a supplier name and a page address in Shopify. */
    async shopifyLinkSources(): Promise<{ variantId: string; productTitle: string; variantTitle: string; sku: string | null; supplierName: string; supplierUrl: string }[]> {
      const rows = await db
        .select({ variantId: shopifyVariants.variantId, productTitle: shopifyVariants.productTitle, variantTitle: shopifyVariants.variantTitle, sku: shopifyVariants.sku, supplierName: shopifyVariants.supplierName, supplierUrl: shopifyVariants.supplierUrl })
        .from(shopifyVariants)
        .where(and(isNull(shopifyVariants.removedAt), sql`${shopifyVariants.supplierName} is not null`, sql`${shopifyVariants.supplierUrl} is not null`))
        .orderBy(asc(shopifyVariants.productTitle), asc(shopifyVariants.variantTitle));
      return rows as { variantId: string; productTitle: string; variantTitle: string; sku: string | null; supplierName: string; supplierUrl: string }[];
    },

    /**
     * Sets each variant's one link from what Shopify holds: Shopify is the one source, so a different address, or a different
     * supplier, replaces what was there and starts the link's history again. The same again changes nothing.
     */
    async upsertFromShopify(rows: { variantId: string; supplierId: string; url: string }[]): Promise<{ created: number; updated: number; unchanged: number }> {
      const result = { created: 0, updated: 0, unchanged: 0 };
      await db.transaction(async (tx) => {
        for (const row of rows) {
          const [current] = await tx.select({ id: mappings.id, supplierId: mappings.supplierId, url: mappings.url }).from(mappings).where(eq(mappings.variantId, row.variantId)).limit(1);
          if (!current) {
            await tx.insert(mappings).values(row);
            result.created++;
          } else if (current.supplierId === row.supplierId && current.url === row.url) {
            result.unchanged++;
          } else {
            await tx.update(mappings).set({ supplierId: row.supplierId, url: row.url, ...RESET, updatedAt: new Date() }).where(eq(mappings.id, current.id));
            result.updated++;
          }
        }
      });
      return result;
    },

    /** The link a variant already has, if any. One link per variant is a rule of the app. */
    async linkForVariant(variantId: string): Promise<{ id: string; supplierId: string } | null> {
      const [row] = await db.select({ id: mappings.id, supplierId: mappings.supplierId }).from(mappings).where(eq(mappings.variantId, variantId)).limit(1);
      return row ?? null;
    },

    /** Every variant Shopify still has, with its SKU. Removed variants are left out so their SKUs cannot match. */
    async liveVariantSkus(): Promise<{ variantId: string; sku: string }[]> {
      const rows = await db.select({ variantId: shopifyVariants.variantId, sku: shopifyVariants.sku }).from(shopifyVariants).where(isNull(shopifyVariants.removedAt));
      return rows.filter((r): r is { variantId: string; sku: string } => !!r.sku?.trim());
    },

    /** Every existing link, for the import preview to compare against. */
    async linksByVariant(): Promise<{ variantId: string; supplierId: string; url: string }[]> {
      return db.select({ variantId: mappings.variantId, supplierId: mappings.supplierId, url: mappings.url }).from(mappings);
    },

    /** Variants with no link. Removed variants are not counted or listed. */
    async unmappedVariants(opts: { search?: string; limit?: number }) {
      const live = isNull(shopifyVariants.removedAt);
      const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(shopifyVariants).where(live);
      const noLink = notExists(db.select({ one: sql`1` }).from(mappings).where(eq(mappings.variantId, shopifyVariants.variantId)));
      const [{ unmapped } = { unmapped: 0 }] = await db.select({ unmapped: count() }).from(shopifyVariants).where(and(live, noLink));
      const items = await db
        .select({ variantId: shopifyVariants.variantId, productTitle: shopifyVariants.productTitle, variantTitle: shopifyVariants.variantTitle, sku: shopifyVariants.sku })
        .from(shopifyVariants)
        .where(and(live, noLink, opts.search ? search(opts.search) : undefined))
        .orderBy(asc(shopifyVariants.productTitle), asc(shopifyVariants.variantTitle))
        .limit(opts.limit ?? 200);
      return { total, unmapped, items };
    },
  };
}
