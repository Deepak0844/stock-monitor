import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { notifications, suppliers } from "./schema.js";

export type NotificationKind = "supplier_needs_reconnect";
export type NotificationReason = "login_required" | "captcha" | "blocked" | "unknown";

export type NotificationRecord = {
  id: string;
  kind: NotificationKind;
  supplierId: string;
  supplierName: string;
  message: string;
  reason: NotificationReason;
  createdAt: Date;
  readAt: Date | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createNotificationRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  return {
    /**
     * Makes sure one notification is open for this kind and supplier. If one is already open its wording is
     * updated (and it stays read if it was read), so a problem found again and again shows once.
     */
    async raise(input: { kind: NotificationKind; supplierId: string; message: string; reason: NotificationReason }): Promise<{ created: boolean }> {
      const [row] = await db
        .insert(notifications)
        .values(input)
        .onConflictDoUpdate({
          target: [notifications.kind, notifications.supplierId],
          targetWhere: sql`${notifications.resolvedAt} is null`,
          set: { message: input.message, reason: input.reason },
        })
        // A row that was inserted has no previous version, so its xmax is 0.
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      return { created: row?.inserted === true };
    },

    /** Closes the open notification, if there is one. */
    async resolve(kind: NotificationKind, supplierId: string): Promise<boolean> {
      const rows = await db
        .update(notifications)
        .set({ resolvedAt: sql`now()` as unknown as Date })
        .where(and(eq(notifications.kind, kind), eq(notifications.supplierId, supplierId), isNull(notifications.resolvedAt)))
        .returning({ id: notifications.id });
      return rows.length > 0;
    },

    /** The open notifications, newest first, each with its supplier's name. */
    async listOpen(): Promise<NotificationRecord[]> {
      const rows = await db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          supplierId: notifications.supplierId,
          supplierName: suppliers.name,
          message: notifications.message,
          reason: notifications.reason,
          createdAt: notifications.createdAt,
          readAt: notifications.readAt,
        })
        .from(notifications)
        .innerJoin(suppliers, eq(suppliers.id, notifications.supplierId))
        .where(isNull(notifications.resolvedAt))
        .orderBy(desc(notifications.createdAt));
      return rows as NotificationRecord[];
    },

    async markRead(id: string): Promise<boolean> {
      if (!UUID.test(id)) return false;
      const rows = await db
        .update(notifications)
        .set({ readAt: sql`now()` as unknown as Date })
        .where(and(eq(notifications.id, id), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return rows.length > 0;
    },
  };
}
