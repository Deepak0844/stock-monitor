import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { LoginSelectors } from "@stock-monitor/supplier-session";
import { notifications, supplierCredentials, suppliers } from "./schema.js";

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
  /** The run an early session check was queued for, so each run gets at most one. */
  sessionPrecheckFor: Date | null;
  keepAliveMinutes: number | null;
  keepAliveNextAt: Date | null;
  failureCount: number;
  autoLogin: boolean;
  stealth: boolean;
  /** False: the product pages show stock without a login, so checks use no session, login or keep-alive. */
  needsLogin: boolean;
  loginSelectors: LoginSelectors | null;
  /** Text that only shows when logged in. Set, a page without it counts as logged out. */
  loggedInMarker: string | null;
  autoLoginFailures: number;
  /** Where login-code emails come from, when not the website's domain. null: the website's domain. */
  codeEmailFrom: string | null;
  autoLoginPausedReason: "wrong_password" | "account_locked" | "too_many_failures" | null;
  lastAutoLoginAt: Date | null;
  lastAutoLoginResult: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SupplierInput = { name: string; websiteUrl: string; loginUrl: string | null; checkIntervalMinutes: number };
export type SupplierPatch = Partial<SupplierInput>;
export type SupplierWrite = { ok: true; supplier: SupplierRecord } | { ok: false; reason: "name_taken" | "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";

/** What the owner sees for a supplier. Paused wins, except when the app paused it because the login needs attention. */
/** `no_login`: a supplier whose pages need no login. The session statuses only count suppliers that need one. */
export type SupplierStatusFilter = "connected" | "needs_reconnect" | "blocked" | "paused" | "not_connected" | "no_login";
export type SupplierPageQuery = { page: number; pageSize: number; search?: string; status?: SupplierStatusFilter };

// In LIKE, backslash is the escape character in PostgreSQL. Escape it and the two wildcards.
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const showsAsPaused = sql`(not ${suppliers.enabled} and ${suppliers.pausedReason} is distinct from 'session')`;

// drizzle wraps the driver error, so the PostgreSQL code is on the error or on its cause.
const isNameTaken = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === UNIQUE_VIOLATION;
};

/**
 * What the owner's fix for a paused automatic login sets (saving the password again, or Resume): the count and pause reset,
 * and a pause the app made because the session needed attention lifted. A pause the owner made is not.
 */
export const liftAutoLoginPause = {
  autoLoginFailures: 0,
  autoLoginPausedReason: null,
  enabled: sql`case when ${suppliers.pausedReason} = 'session' then true else ${suppliers.enabled} end`,
  pausedReason: sql`case when ${suppliers.pausedReason} = 'session' then null else ${suppliers.pausedReason} end`,
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
        query.status === "no_login" ? and(sql`not ${showsAsPaused}`, sql`not ${suppliers.needsLogin}`) : undefined,
        query.status && query.status !== "paused" && query.status !== "no_login" ? and(sql`not ${showsAsPaused}`, suppliers.needsLogin, eq(suppliers.sessionStatus, query.status)) : undefined,
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
     * session needed attention is lifted. A pause the owner made is not. The owner's own login also resets automatic login.
     */
    markConnected: (id: string) =>
      set(id, {
        sessionStatus: "connected",
        autoLoginFailures: 0,
        autoLoginPausedReason: null,
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
        // Both need permission, so losing it turns them off in the same statement.
        ...(input.status !== "granted" ? { autoLogin: false, stealth: false } : {}),
        ...(input.pauseSeconds !== undefined ? { checkPauseSeconds: input.pauseSeconds } : {}),
      }),

    /** Changes the automatic login settings. Turning it on needs `granted` permission and saved credentials. */
    async setAutoLogin(
      id: string,
      patch: { autoLogin?: boolean; stealth?: boolean; loginSelectors?: LoginSelectors | null; loggedInMarker?: string | null; codeEmailFrom?: string | null },
    ): Promise<SupplierWrite | { ok: false; reason: "not_granted" | "no_credentials" }> {
      const current = await one(id);
      if (!current) return { ok: false, reason: "not_found" };
      if (patch.autoLogin || patch.stealth) {
        if (current.automationPermission !== "granted") return { ok: false, reason: "not_granted" };
      }
      if (patch.autoLogin) {
        const [row] = await db.select({ id: supplierCredentials.supplierId }).from(supplierCredentials).where(eq(supplierCredentials.supplierId, id)).limit(1);
        if (!row) return { ok: false, reason: "no_credentials" };
      }
      const row = await set(id, {
        ...(patch.autoLogin !== undefined ? { autoLogin: patch.autoLogin } : {}),
        ...(patch.stealth !== undefined ? { stealth: patch.stealth } : {}),
        ...(patch.loginSelectors !== undefined ? { loginSelectors: patch.loginSelectors } : {}),
        ...(patch.loggedInMarker !== undefined ? { loggedInMarker: patch.loggedInMarker } : {}),
        ...(patch.codeEmailFrom !== undefined ? { codeEmailFrom: patch.codeEmailFrom } : {}),
      });
      return row ? { ok: true, supplier: row } : { ok: false, reason: "not_found" };
    },

    /** Records one automatic login attempt and what it means for the failure count and the pause. */
    async recordAutoLogin(
      id: string,
      result: string,
      outcome: "reset" | "failed" | "pause_wrong_password" | "pause_account_locked" | "unchanged",
    ): Promise<SupplierRecord> {
      const failures = suppliers.autoLoginFailures;
      const values = {
        lastAutoLoginAt: sql`now()`,
        lastAutoLoginResult: result,
        ...(outcome === "reset" ? { autoLoginFailures: 0 } : {}),
        ...(outcome === "failed"
          ? {
              autoLoginFailures: sql`${failures} + 1`,
              autoLoginPausedReason: sql`case when ${failures} + 1 >= 2 then 'too_many_failures' else ${suppliers.autoLoginPausedReason} end`,
            }
          : {}),
        ...(outcome === "pause_wrong_password" ? { autoLoginFailures: sql`${failures} + 1`, autoLoginPausedReason: "wrong_password" } : {}),
        ...(outcome === "pause_account_locked" ? { autoLoginFailures: sql`${failures} + 1`, autoLoginPausedReason: "account_locked" } : {}),
      };
      const row = await set(id, values);
      if (!row) throw new Error("supplier not found");
      return row;
    },

    /** The owner lifts an automatic login pause, and a pause the app made because the session needed attention. */
    async resumeAutoLogin(id: string): Promise<boolean> {
      return (await set(id, liftAutoLoginPause)) !== null;
    },

    /** The region label stock checks look for on this supplier's pages. null clears it. */
    setRegion: (id: string, region: string | null) => set(id, { defaultRegion: region }),

    /** Sets or turns off automatic checks. Resets the failure count. */
    /** `keepAliveMinutes` left out keeps the keep-alive as it is; given, it also clears the next keep-alive time. */
    setSchedule: (id: string, input: { intervalMinutes: number | null; window: { start: string; end: string } | null; nextCheckAt: Date | null; keepAliveMinutes?: number | null }) =>
      set(id, {
        scheduleIntervalMinutes: input.intervalMinutes,
        scheduleWindowStart: input.window?.start ?? null,
        scheduleWindowEnd: input.window?.end ?? null,
        nextCheckAt: input.nextCheckAt,
        failureCount: 0,
        ...(input.keepAliveMinutes !== undefined ? { keepAliveMinutes: input.keepAliveMinutes, keepAliveNextAt: null } : {}),
      }),

    /** When the next keep-alive visit is due. */
    async setKeepAliveNext(id: string, at: Date): Promise<void> {
      await set(id, { keepAliveNextAt: at });
    },

    /** Suppliers with keep-alive turned on. A supplier that needs no login has nothing to keep alive. */
    async keepingAlive(): Promise<SupplierRecord[]> {
      return (await db.select().from(suppliers).where(sql`${suppliers.keepAliveMinutes} is not null and ${suppliers.needsLogin}`)) as SupplierRecord[];
    },

    /**
     * Whether the supplier's pages need a login. Turning it off keeps the saved session and login, so turning it on restores
     * them. It also lifts a pause the app made because the login needed attention, and resolves that notice: with no login
     * there is nothing left to fix. A pause the owner made stays.
     */
    async setNeedsLogin(id: string, needsLogin: boolean): Promise<SupplierRecord | null> {
      if (needsLogin) return set(id, { needsLogin });
      const row = await set(id, {
        needsLogin,
        enabled: sql`case when ${suppliers.pausedReason} = 'session' then true else ${suppliers.enabled} end`,
        pausedReason: sql`case when ${suppliers.pausedReason} = 'session' then null else ${suppliers.pausedReason} end`,
        // A public page can be read gently but sooner: the app's default pause of 10 s becomes 3 s. A pause the owner set stays.
        checkPauseSeconds: sql`case when ${suppliers.checkPauseSeconds} = 10 then 3 else ${suppliers.checkPauseSeconds} end`,
      });
      if (row) {
        await db
          .update(notifications)
          .set({ resolvedAt: sql`now()` as unknown as Date })
          .where(and(eq(notifications.kind, "supplier_needs_reconnect"), eq(notifications.supplierId, id), isNull(notifications.resolvedAt)));
      }
      return row;
    },

    /** The next check time and failure count, written when a run ends. */
    async recordRunEnd(id: string, input: { nextCheckAt: Date; failureCount: number }): Promise<void> {
      await set(id, { nextCheckAt: input.nextCheckAt, failureCount: input.failureCount });
    },

    /** An early session check was queued for the run due at `forRun`. */
    async markPrecheckQueued(id: string, forRun: Date): Promise<void> {
      await set(id, { sessionPrecheckFor: forRun });
    },

    /** Suppliers that have automatic checks turned on. */
    async scheduled(): Promise<SupplierRecord[]> {
      return (await db.select().from(suppliers).where(sql`${suppliers.scheduleIntervalMinutes} is not null`)) as SupplierRecord[];
    },

    pause: (id: string) => set(id, { enabled: false, pausedReason: "owner" }),
    resume: (id: string) => set(id, { enabled: true, pausedReason: null }),
  };
}
