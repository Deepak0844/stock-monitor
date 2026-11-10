import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { appSessions, users } from "@stock-monitor/db";

export const SESSION_COOKIE = "sid";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type SessionUser = { id: string; email: string };

export async function findSessionUser<S extends Record<string, unknown>>(
  db: NodePgDatabase<S>,
  token: string,
): Promise<SessionUser | null> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(appSessions)
    .innerJoin(users, eq(users.id, appSessions.userId))
    .where(and(eq(appSessions.tokenHash, hashToken(token)), gt(appSessions.expiresAt, sql`now()`)))
    .limit(1);
  return rows[0] ?? null;
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession<S extends Record<string, unknown>>(
  db: NodePgDatabase<S>,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(appSessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function deleteSession<S extends Record<string, unknown>>(
  db: NodePgDatabase<S>,
  token: string,
): Promise<void> {
  await db.delete(appSessions).where(eq(appSessions.tokenHash, hashToken(token)));
}
