import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { appSettings, proposals, shopifyVariants, stockObservations, suppliers } from "./schema.js";

export type ProposalState = "open" | "approved" | "applied" | "conflict" | "failed" | "rejected" | "expired" | "replaced";
export type Proposal = typeof proposals.$inferSelect;
/** A suggestion with the words the screen shows. Numbers, states and fixed codes only. */
export type ProposalView = Proposal & {
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  supplierName: string;
  tracked: boolean;
  inventoryPolicy: string;
  observedAnswer: string | null;
  observedReason: string | null;
  observedAt: Date | null;
};

export type EvaluateInput = {
  variantId: string;
  mappingId: string;
  supplierId: string;
  observationId: number | null;
  shopifyQuantitySeen: number;
  /** What the rules want now, or null for nothing. */
  wanted: { kind: string; proposedQuantity: number } | null;
  expiresAt: Date;
  /** Why an open suggestion is closed when nothing is wanted: could_not_tell, no_longer_needed, link_off. */
  closeReason?: string;
};
export type EvaluateResult = { change: "created" | "kept" | "replaced" | "closed" | "none"; proposal: Proposal | null };
export type ProposalSettings = { defaultQuantity: number; expiryHours: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";
const isTaken = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === UNIQUE_VIOLATION;
};
const DEFAULTS: ProposalSettings = { defaultQuantity: 5, expiryHours: 24 };
const SETTINGS_KEY = "proposals";

export function createProposalRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  const viewQuery = () =>
    db
      .select({
        proposal: proposals,
        productTitle: shopifyVariants.productTitle,
        variantTitle: shopifyVariants.variantTitle,
        sku: shopifyVariants.sku,
        supplierName: suppliers.name,
        tracked: shopifyVariants.tracked,
        inventoryPolicy: shopifyVariants.inventoryPolicy,
        observedAnswer: stockObservations.answer,
        observedReason: stockObservations.reason,
        observedAt: stockObservations.observedAt,
      })
      .from(proposals)
      .innerJoin(shopifyVariants, eq(shopifyVariants.variantId, proposals.variantId))
      .innerJoin(suppliers, eq(suppliers.id, proposals.supplierId))
      .leftJoin(stockObservations, eq(stockObservations.id, proposals.observationId));
  type ViewRow = Awaited<ReturnType<ReturnType<typeof viewQuery>["limit"]>>[number];
  const toView = ({ proposal, ...rest }: ViewRow): ProposalView => ({ ...proposal, ...rest });

  async function liveFor(variantId: string): Promise<Proposal | null> {
    const [row] = await db.select().from(proposals).where(and(eq(proposals.variantId, variantId), inArray(proposals.state, ["open", "approved"]))).limit(1);
    return row ?? null;
  }

  async function evaluateOnce(i: EvaluateInput): Promise<EvaluateResult> {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(proposals)
        .where(and(eq(proposals.variantId, i.variantId), inArray(proposals.state, ["open", "approved"])))
        .for("update")
        .limit(1);
      // An approved suggestion is waiting for Shopify: leave it alone.
      if (existing?.state === "approved") return { change: "kept", proposal: existing };

      if (!i.wanted) {
        if (!existing) return { change: "none", proposal: null };
        await tx.update(proposals).set({ state: "replaced", closedReason: i.closeReason ?? "no_longer_needed" }).where(eq(proposals.id, existing.id));
        return { change: "closed", proposal: null };
      }
      if (existing && existing.kind === i.wanted.kind && existing.proposedQuantity === i.wanted.proposedQuantity && existing.shopifyQuantitySeen === i.shopifyQuantitySeen) {
        return { change: "kept", proposal: existing };
      }
      if (existing) await tx.update(proposals).set({ state: "replaced", closedReason: "newer_answer" }).where(eq(proposals.id, existing.id));
      const [created] = await tx
        .insert(proposals)
        .values({
          variantId: i.variantId,
          mappingId: i.mappingId,
          supplierId: i.supplierId,
          observationId: i.observationId,
          kind: i.wanted.kind,
          shopifyQuantitySeen: i.shopifyQuantitySeen,
          proposedQuantity: i.wanted.proposedQuantity,
          expiresAt: i.expiresAt,
        })
        .returning();
      return { change: existing ? "replaced" : "created", proposal: created! };
    });
  }

  return {
    /** Creates, keeps, replaces or closes the one live suggestion for a variant. Safe to repeat and to run twice at once. */
    async evaluateFor(i: EvaluateInput): Promise<EvaluateResult> {
      try {
        return await evaluateOnce(i);
      } catch (error) {
        if (!isTaken(error)) throw error;
        // Another evaluation created it first: report what is there now.
        return { change: "kept", proposal: await liveFor(i.variantId) };
      }
    },

    async get(id: string): Promise<Proposal | null> {
      if (!UUID.test(id)) return null;
      const [row] = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1);
      return row ?? null;
    },

    async getView(id: string): Promise<ProposalView | null> {
      if (!UUID.test(id)) return null;
      const [row] = await viewQuery().where(eq(proposals.id, id)).limit(1);
      return row ? toView(row) : null;
    },

    async open(): Promise<ProposalView[]> {
      const rows = await viewQuery().where(inArray(proposals.state, ["open", "approved"])).orderBy(desc(proposals.createdAt));
      return rows.map(toView);
    },

    async history(limit: number, offset: number): Promise<ProposalView[]> {
      const rows = await viewQuery()
        .where(sql`${proposals.state} not in ('open', 'approved')`)
        .orderBy(desc(proposals.createdAt), desc(proposals.id))
        .limit(limit)
        .offset(offset);
      return rows.map(toView);
    },

    /** Moves an open, unexpired suggestion to approved and stores its idempotency key. Returns null when it cannot be approved (including a second press). */
    async markApproved(id: string, quantity: number, by: string, now: Date): Promise<Proposal | null> {
      if (!UUID.test(id)) return null;
      const [row] = await db
        .update(proposals)
        .set({
          state: "approved",
          approvedQuantity: quantity,
          edited: sql`${quantity} <> ${proposals.proposedQuantity}`,
          decidedAt: now,
          decidedBy: by,
          idempotencyKey: randomUUID(),
        })
        .where(and(eq(proposals.id, id), eq(proposals.state, "open"), gt(proposals.expiresAt, now)))
        .returning();
      return row ?? null;
    },

    async markApplied(id: string, resultQuantity: number, now: Date): Promise<boolean> {
      const rows = await db
        .update(proposals)
        .set({ state: "applied", appliedAt: now, resultCode: "applied", resultQuantity })
        .where(and(eq(proposals.id, id), eq(proposals.state, "approved")))
        .returning({ id: proposals.id });
      return rows.length > 0;
    },

    /** Shopify showed a different number than the suggestion was made from: nothing was written. */
    async markConflict(id: string, currentQuantity: number | null): Promise<boolean> {
      const rows = await db
        .update(proposals)
        .set({ state: "conflict", resultCode: "changed", resultQuantity: currentQuantity })
        .where(and(eq(proposals.id, id), eq(proposals.state, "approved")))
        .returning({ id: proposals.id });
      return rows.length > 0;
    },

    async markFailed(id: string, code: string): Promise<boolean> {
      const rows = await db.update(proposals).set({ state: "failed", resultCode: code }).where(and(eq(proposals.id, id), eq(proposals.state, "approved"))).returning({ id: proposals.id });
      return rows.length > 0;
    },

    async bumpAttempts(id: string): Promise<number> {
      const [row] = await db.update(proposals).set({ attempts: sql`${proposals.attempts} + 1` }).where(eq(proposals.id, id)).returning({ attempts: proposals.attempts });
      return row?.attempts ?? 0;
    },

    async reject(id: string, note: string | null, by: string, now: Date): Promise<boolean> {
      if (!UUID.test(id)) return false;
      const rows = await db
        .update(proposals)
        .set({ state: "rejected", note, decidedAt: now, decidedBy: by })
        .where(and(eq(proposals.id, id), eq(proposals.state, "open")))
        .returning({ id: proposals.id });
      return rows.length > 0;
    },

    /** Marks open suggestions past their time as expired. Approved ones are never expired. */
    async expireDue(now: Date): Promise<number> {
      const rows = await db.update(proposals).set({ state: "expired" }).where(and(eq(proposals.state, "open"), lte(proposals.expiresAt, now))).returning({ id: proposals.id });
      return rows.length;
    },

    async settings(): Promise<ProposalSettings> {
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
      const v = (row?.value ?? {}) as Partial<ProposalSettings>;
      return { defaultQuantity: v.defaultQuantity ?? DEFAULTS.defaultQuantity, expiryHours: v.expiryHours ?? DEFAULTS.expiryHours };
    },

    async saveSettings(settings: ProposalSettings): Promise<void> {
      await db
        .insert(appSettings)
        .values({ key: SETTINGS_KEY, value: settings })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: settings, updatedAt: new Date() } });
    },
  };
}
