import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditEvents } from "@stock-monitor/db";
import { redactSecrets } from "@stock-monitor/shared";

export type AuditEvent = {
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
  requestId?: string;
};

export function createAuditWriter<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  return {
    async record(event: AuditEvent): Promise<void> {
      await db.insert(auditEvents).values({
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        details: redactSecrets(event.details ?? {}),
        requestId: event.requestId,
      });
    },
  };
}
