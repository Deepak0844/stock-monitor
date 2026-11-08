import { asc, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { suppliers } from "./schema.js";

export type SupplierRecord = {
  id: string;
  name: string;
  websiteUrl: string;
  loginUrl: string | null;
  checkIntervalMinutes: number;
  enabled: boolean;
  sessionStatus: "not_connected" | "connected" | "needs_reconnect" | "blocked";
  pausedReason: "owner" | "session" | null;
  lastSessionCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SupplierInput = { name: string; websiteUrl: string; loginUrl: string | null; checkIntervalMinutes: number };
export type SupplierPatch = Partial<SupplierInput>;
export type SupplierWrite = { ok: true; supplier: SupplierRecord } | { ok: false; reason: "name_taken" | "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";

// drizzle wraps the driver error, so the PostgreSQL code is on the error or on its cause.
const isNameTaken = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === UNIQUE_VIOLATION;
};

export function createSupplierRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  const one = async (id: string): Promise<SupplierRecord | null> => {
    if (!UUID.test(id)) return null;
    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    return (row as SupplierRecord | undefined) ?? null;
  };

  const set = async (id: string, values: Partial<{ [K in keyof typeof suppliers.$inferInsert]: (typeof suppliers.$inferInsert)[K] | SQL }>): Promise<SupplierRecord | null> => {
    if (!UUID.test(id)) return null;
    const [row] = await db.update(suppliers).set({ ...values, updatedAt: new Date() }).where(eq(suppliers.id, id)).returning();
    return (row as SupplierRecord | undefined) ?? null;
  };

  return {
    get: one,

    async list(): Promise<SupplierRecord[]> {
      return (await db.select().from(suppliers).orderBy(asc(sql`lower(${suppliers.name})`))) as SupplierRecord[];
    },

    async create(input: SupplierInput): Promise<SupplierWrite> {
      try {
        const [row] = await db.insert(suppliers).values(input).returning();
        return { ok: true, supplier: row as SupplierRecord };
      } catch (error) {
        if (isNameTaken(error)) return { ok: false, reason: "name_taken" };
        throw error;
      }
    },

    async update(id: string, patch: SupplierPatch): Promise<SupplierWrite> {
      try {
        const row = await set(id, patch);
        return row ? { ok: true, supplier: row } : { ok: false, reason: "not_found" };
      } catch (error) {
        if (isNameTaken(error)) return { ok: false, reason: "name_taken" };
        throw error;
      }
    },

    async remove(id: string): Promise<boolean> {
      if (!UUID.test(id)) return false;
      const rows = await db.delete(suppliers).where(eq(suppliers.id, id)).returning({ id: suppliers.id });
      return rows.length > 0;
    },

    /**
     * A login has just been saved. The supplier is connected, and a pause the app made because the
     * session needed attention is lifted. A pause the owner made is not.
     */
    markConnected: (id: string) =>
      set(id, {
        sessionStatus: "connected",
        enabled: sql`case when ${suppliers.pausedReason} = 'session' then true else ${suppliers.enabled} end`,
        pausedReason: sql`case when ${suppliers.pausedReason} = 'session' then null else ${suppliers.pausedReason} end`,
      }),
    /**
     * A session check found a problem. The supplier gets the status, and is paused because the session
     * needs attention, unless it was already paused: a pause the owner made stays the owner's.
     */
    markNeedsAttention: (id: string, status: "needs_reconnect" | "blocked") =>
      set(id, {
        sessionStatus: status,
        enabled: sql`case when ${suppliers.pausedReason} is null then false else ${suppliers.enabled} end`,
        pausedReason: sql`case when ${suppliers.pausedReason} is null then 'session' else ${suppliers.pausedReason} end`,
        lastSessionCheckAt: sql`now()`,
      }),
    /** A session check found the session working: like markConnected, and records the check. */
    markVerified: (id: string) =>
      set(id, {
        sessionStatus: "connected",
        enabled: sql`case when ${suppliers.pausedReason} = 'session' then true else ${suppliers.enabled} end`,
        pausedReason: sql`case when ${suppliers.pausedReason} = 'session' then null else ${suppliers.pausedReason} end`,
        lastSessionCheckAt: sql`now()`,
      }),
    /** A check was tried but the supplier could not be reached. Nothing else changes. */
    touchChecked: (id: string) => set(id, { lastSessionCheckAt: sql`now()` }),
    markNotConnected: (id: string) => set(id, { sessionStatus: "not_connected" }),

    pause: (id: string) => set(id, { enabled: false, pausedReason: "owner" }),
    resume: (id: string) => set(id, { enabled: true, pausedReason: null }),
  };
}
