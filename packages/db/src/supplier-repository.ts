import { and, asc, count, eq, ilike, or, sql, type SQL } from "drizzle-orm";
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
  automationPermission: "unknown" | "granted" | "not_granted";
  permissionNote: string | null;
  permissionSetAt: Date | null;
  checkPauseSeconds: number;
  /** The region label stock checks look for, unless a link has its own. */
  defaultRegion: string | null;
  /** Automatic checks: minutes between runs, null = off. */
  scheduleIntervalMinutes: number | null;
  scheduleWindowStart: string | null;
  scheduleWindowEnd: string | null;
  nextCheckAt: Date | null;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SupplierInput = { name: string; websiteUrl: string; loginUrl: string | null; checkIntervalMinutes: number };
export type SupplierPatch = Partial<SupplierInput>;
export type SupplierWrite = { ok: true; supplier: SupplierRecord } | { ok: false; reason: "name_taken" | "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";

/** What the owner sees for a supplier. Paused wins, except when the app paused it because the login needs attention. */
export type SupplierStatusFilter = "connected" | "needs_reconnect" | "blocked" | "paused" | "not_connected";
export type SupplierPageQuery = { page: number; pageSize: number; search?: string; status?: SupplierStatusFilter };

// In LIKE, backslash is the escape character in PostgreSQL. Escape it and the two wildcards.
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const showsAsPaused = sql`(not ${suppliers.enabled} and ${suppliers.pausedReason} is distinct from 'session')`;

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

    /** One page of suppliers, in the same order as `list`, with how many match in all. */
    async page(query: SupplierPageQuery): Promise<{ items: SupplierRecord[]; total: number }> {
      const text = query.search?.trim();
      const like = text ? `%${escapeLike(text)}%` : undefined;
      const where = and(
        like ? or(ilike(suppliers.name, like), ilike(suppliers.websiteUrl, like)) : undefined,
        query.status === "paused" ? showsAsPaused : undefined,
        query.status && query.status !== "paused" ? and(sql`not ${showsAsPaused}`, eq(suppliers.sessionStatus, query.status)) : undefined,
      );
      const items = (await db
        .select()
        .from(suppliers)
        .where(where)
        .orderBy(asc(sql`lower(${suppliers.name})`), asc(suppliers.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)) as SupplierRecord[];
      const [row] = await db.select({ n: count() }).from(suppliers).where(where);
      return { items, total: Number(row?.n ?? 0) };
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

    /** The owner's record of whether the supplier allows automatic checks. */
    setPermission: (id: string, input: { status: SupplierRecord["automationPermission"]; note: string | null; pauseSeconds?: number }) =>
      set(id, {
        automationPermission: input.status,
        permissionNote: input.note,
        permissionSetAt: sql`now()`,
        ...(input.pauseSeconds !== undefined ? { checkPauseSeconds: input.pauseSeconds } : {}),
      }),

    /** The region label stock checks look for on this supplier's pages. null clears it. */
    setRegion: (id: string, region: string | null) => set(id, { defaultRegion: region }),

    /** Sets or turns off automatic checks. Resets the failure count. */
    setSchedule: (id: string, input: { intervalMinutes: number | null; window: { start: string; end: string } | null; nextCheckAt: Date | null }) =>
      set(id, {
        scheduleIntervalMinutes: input.intervalMinutes,
        scheduleWindowStart: input.window?.start ?? null,
        scheduleWindowEnd: input.window?.end ?? null,
        nextCheckAt: input.nextCheckAt,
        failureCount: 0,
      }),

    /** The next check time and failure count, written when a run ends. */
    async recordRunEnd(id: string, input: { nextCheckAt: Date; failureCount: number }): Promise<void> {
      await set(id, { nextCheckAt: input.nextCheckAt, failureCount: input.failureCount });
    },

    /** Suppliers that have automatic checks turned on. */
    async scheduled(): Promise<SupplierRecord[]> {
      return (await db.select().from(suppliers).where(sql`${suppliers.scheduleIntervalMinutes} is not null`)) as SupplierRecord[];
    },

    pause: (id: string) => set(id, { enabled: false, pausedReason: "owner" }),
    resume: (id: string) => set(id, { enabled: true, pausedReason: null }),
  };
}
