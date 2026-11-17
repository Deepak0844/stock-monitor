import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Encrypted } from "@stock-monitor/crypto";
import { supplierCredentials, suppliers } from "./schema.js";

export function createSupplierCredentialsRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  const read = async (supplierId: string) => {
    const [row] = await db.select().from(supplierCredentials).where(eq(supplierCredentials.supplierId, supplierId)).limit(1);
    return row ?? null;
  };

  return {
    /** Saves the sealed login. New credentials replace the old and lift any automatic login pause, in one transaction. */
    async save(supplierId: string, sealed: Encrypted): Promise<{ savedAt: Date }> {
      return db.transaction(async (tx) => {
        const values = { ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, keyId: sealed.keyId, savedAt: new Date() };
        const [row] = await tx
          .insert(supplierCredentials)
          .values({ supplierId, ...values })
          .onConflictDoUpdate({ target: supplierCredentials.supplierId, set: values })
          .returning({ savedAt: supplierCredentials.savedAt });
        await tx.update(suppliers).set({ autoLoginFailures: 0, autoLoginPausedReason: null }).where(eq(suppliers.id, supplierId));
        return { savedAt: row!.savedAt };
      });
    },

    /** The sealed login, for the one place that decrypts it to log in. */
    async getSealed(supplierId: string): Promise<Encrypted | null> {
      const row = await read(supplierId);
      return row ? { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyId: row.keyId } : null;
    },

    async savedAt(supplierId: string): Promise<Date | null> {
      return (await read(supplierId))?.savedAt ?? null;
    },

    async remove(supplierId: string): Promise<boolean> {
      const rows = await db.delete(supplierCredentials).where(eq(supplierCredentials.supplierId, supplierId)).returning({ id: supplierCredentials.supplierId });
      return rows.length > 0;
    },
  };
}
