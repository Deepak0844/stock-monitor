import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Encrypted } from "@stock-monitor/crypto";
import { supplierSessions } from "./schema.js";

/** Plain facts about a saved session. None of it is secret, and none of it can be used to log in. */
export type SessionFacts = { savedAt: Date; lastVerifiedAt: Date | null; cookieCount: number; domains: string[]; sizeBytes: number };

type State = { cookies: Record<string, unknown>[]; origins: Record<string, unknown>[] };

const hostOf = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value.replace(/^\./, "")}`).hostname || null;
  } catch {
    return null;
  }
};

/** The sites a saved session covers, from its cookie domains and storage origins. */
const domainsOf = (state: State): string[] => {
  const hosts = [...state.cookies.map((c) => hostOf(c.domain)), ...state.origins.map((o) => hostOf(o.origin))];
  return [...new Set(hosts.filter((h): h is string => h !== null))].sort();
};

export function createSupplierSessionRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  return {
    /** Saves the sealed session. A new login replaces the old one. `state` is only read to work out the plain facts, and is not stored. */
    async save(supplierId: string, sealed: Encrypted, state: State): Promise<void> {
      const values = {
        stateCiphertext: sealed.ciphertext,
        stateIv: sealed.iv,
        stateTag: sealed.tag,
        stateKeyId: sealed.keyId,
        cookieCount: state.cookies.length,
        domains: domainsOf(state),
        sizeBytes: Buffer.byteLength(JSON.stringify(state)),
        savedAt: sql`now()` as unknown as Date,
        lastVerifiedAt: null,
      };
      await db.insert(supplierSessions).values({ supplierId, ...values }).onConflictDoUpdate({ target: supplierSessions.supplierId, set: values });
    },

    async facts(supplierId: string): Promise<SessionFacts | null> {
      const [row] = await db.select().from(supplierSessions).where(eq(supplierSessions.supplierId, supplierId)).limit(1);
      return row ? { savedAt: row.savedAt, lastVerifiedAt: row.lastVerifiedAt, cookieCount: row.cookieCount, domains: row.domains, sizeBytes: row.sizeBytes } : null;
    },

    /** The sealed session, for the check that decrypts it. Nothing else reads it back. */
    async getSealed(supplierId: string): Promise<Encrypted | null> {
      const [row] = await db.select().from(supplierSessions).where(eq(supplierSessions.supplierId, supplierId)).limit(1);
      return row ? { ciphertext: row.stateCiphertext, iv: row.stateIv, tag: row.stateTag, keyId: row.stateKeyId } : null;
    },

    /** Records that a check found this session working. */
    async markVerified(supplierId: string): Promise<boolean> {
      const rows = await db
        .update(supplierSessions)
        .set({ lastVerifiedAt: sql`now()` as unknown as Date })
        .where(eq(supplierSessions.supplierId, supplierId))
        .returning({ id: supplierSessions.supplierId });
      return rows.length > 0;
    },

    async remove(supplierId: string): Promise<boolean> {
      const rows = await db.delete(supplierSessions).where(eq(supplierSessions.supplierId, supplierId)).returning({ id: supplierSessions.supplierId });
      return rows.length > 0;
    },
  };
}
