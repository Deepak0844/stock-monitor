import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { tokenMatchesHash } from "@stock-monitor/supplier-session";
import { loginSessions } from "./schema.js";

export type LoginStatus = "starting" | "ready" | "connected" | "saving" | "finished" | "cancelled" | "expired" | "failed";
export type FailureReason = "browser_unavailable" | "window_failed" | "window_already_open" | "read_failed" | "save_failed";

/** What the API and screens may see. It has no token and no hash. */
export type LoginSessionRecord = {
  id: string;
  supplierId: string;
  status: LoginStatus;
  startedBy: string | null;
  browserSessionId: string | null;
  failureReason: FailureReason | null;
  createdAt: Date;
  tokenExpiresAt: Date;
  expiresAt: Date | null;
  tokenUsedAt: Date | null;
  endedAt: Date | null;
};

export type CreateLoginSession = { supplierId: string; tokenHash: string; tokenExpiresAt: Date; startedBy: string | null };
export type CreateResult = { ok: true; session: LoginSessionRecord } | { ok: false; reason: "open_attempt" };
export type ConsumeResult =
  | { ok: true; session: LoginSessionRecord }
  | { ok: false; reason: "invalid" | "used" | "expired" | "not_ready" };

const OPEN: LoginStatus[] = ["starting", "ready", "connected", "saving"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;
const UNIQUE_VIOLATION = "23505";
// An attempt still "starting" after this long was left behind by a crash.
const STARTING_GRACE = sql`interval '1 minute'`;

const isOpenAttempt = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === UNIQUE_VIOLATION;
};

const toRecord = (row: typeof loginSessions.$inferSelect): LoginSessionRecord => {
  const { tokenHash: _hash, ...rest } = row;
  return rest as LoginSessionRecord;
};

export function createLoginSessionRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  const change = async (id: string, from: LoginStatus[], values: Partial<typeof loginSessions.$inferInsert>): Promise<boolean> => {
    if (!UUID.test(id)) return false;
    const rows = await db
      .update(loginSessions)
      .set(values)
      .where(and(eq(loginSessions.id, id), inArray(loginSessions.status, from)))
      .returning({ id: loginSessions.id });
    return rows.length > 0;
  };

  return {
    async create(input: CreateLoginSession): Promise<CreateResult> {
      try {
        const [row] = await db.insert(loginSessions).values(input).returning();
        return { ok: true, session: toRecord(row as typeof loginSessions.$inferSelect) };
      } catch (error) {
        if (isOpenAttempt(error)) return { ok: false, reason: "open_attempt" };
        throw error;
      }
    },

    async get(id: string): Promise<LoginSessionRecord | null> {
      if (!UUID.test(id)) return null;
      const [row] = await db.select().from(loginSessions).where(eq(loginSessions.id, id)).limit(1);
      return row ? toRecord(row) : null;
    },

    /** The attempt that is open now, if any. */
    async open(): Promise<LoginSessionRecord | null> {
      const [row] = await db.select().from(loginSessions).where(inArray(loginSessions.status, OPEN)).limit(1);
      return row ? toRecord(row) : null;
    },

    markReady: (id: string, window: { browserSessionId: string; expiresAt: Date }) =>
      change(id, ["starting"], { status: "ready", browserSessionId: window.browserSessionId, expiresAt: window.expiresAt }),

    /**
     * Uses the one-time token. It works once: the check and the change happen in one statement, so of many
     * simultaneous tries exactly one wins. Every refusal looks the same to the caller except for the reason
     * code kept for the audit trail.
     */
    async consumeToken(id: string, token: string): Promise<ConsumeResult> {
      if (!UUID.test(id) || typeof token !== "string" || !HEX_64.test(token)) return { ok: false, reason: "invalid" };
      const [row] = await db.select().from(loginSessions).where(eq(loginSessions.id, id)).limit(1);
      if (!row || !tokenMatchesHash(token, row.tokenHash)) return { ok: false, reason: "invalid" };
      if (row.tokenUsedAt) return { ok: false, reason: "used" };
      if (row.status !== "ready") return { ok: false, reason: "not_ready" };
      if (row.tokenExpiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

      const [won] = await db
        .update(loginSessions)
        .set({ tokenUsedAt: sql`now()`, status: "connected" })
        .where(and(eq(loginSessions.id, id), eq(loginSessions.status, "ready"), isNull(loginSessions.tokenUsedAt), gt(loginSessions.tokenExpiresAt, sql`now()`)))
        .returning();
      return won ? { ok: true, session: toRecord(won) } : { ok: false, reason: "used" };
    },

    beginSaving: (id: string) => change(id, ["ready", "connected"], { status: "saving" }),
    finish: (id: string) => change(id, ["saving"], { status: "finished", endedAt: sql`now()` as unknown as Date }),
    cancel: (id: string) => change(id, OPEN, { status: "cancelled", endedAt: sql`now()` as unknown as Date }),
    fail: (id: string, reason: FailureReason) => change(id, OPEN, { status: "failed", failureReason: reason, endedAt: sql`now()` as unknown as Date }),

    /** Marks attempts whose time has run out, and says which, so the caller can make sure their windows are closed. */
    async expireOverdue(): Promise<{ id: string; browserSessionId: string | null }[]> {
      const rows = await db
        .update(loginSessions)
        .set({ status: "expired", endedAt: sql`now()` as unknown as Date })
        .where(
          and(
            inArray(loginSessions.status, OPEN),
            or(
              and(sql`${loginSessions.expiresAt} is not null`, sql`${loginSessions.expiresAt} < now()`),
              and(eq(loginSessions.status, "starting"), sql`${loginSessions.createdAt} < now() - ${STARTING_GRACE}`),
            ),
          ),
        )
        .returning({ id: loginSessions.id, browserSessionId: loginSessions.browserSessionId });
      return rows;
    },
  };
}
