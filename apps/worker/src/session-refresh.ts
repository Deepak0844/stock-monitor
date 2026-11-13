import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { Encrypted } from "@stock-monitor/crypto";
import type { createSupplierSessionRepository } from "@stock-monitor/db";
import { mergeSessionState, sameSessionState, sealSessionState, type SessionState } from "@stock-monitor/supplier-session";

export type SessionRefreshDeps = {
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  audit: ReturnType<typeof createAuditWriter>;
  key: Buffer;
  logger: Logger;
};

/** A saved session as a check loaded it: the sealed row (its `iv` says which login it is) and what it holds. */
export type LoadedSession = { sealed: Encrypted; state: SessionState };

/**
 * Keeps a session the supplier extended. `fresh` is the session the browser ended with after an ok page, and only then.
 * It is merged into the loaded one and saved, unless the owner logged in again since the check started. Nothing about the
 * cookies is logged or audited.
 */
export async function saveRefreshedSession(
  deps: SessionRefreshDeps,
  supplierId: string,
  loaded: LoadedSession,
  fresh: SessionState | undefined,
): Promise<"saved" | "unchanged" | "stale" | "none" | "failed"> {
  if (!fresh) return "none";
  try {
    return await save(deps, supplierId, loaded, fresh);
  } catch (error) {
    // A side task: the check's own result stands. The error's name only, since a message could hold session data.
    deps.logger.warn({ supplierId, err: error instanceof Error ? error.name : "unknown" }, "refreshed session could not be saved");
    return "failed";
  }
}

async function save(deps: SessionRefreshDeps, supplierId: string, loaded: LoadedSession, fresh: SessionState): Promise<"saved" | "unchanged" | "stale"> {
  const merged = mergeSessionState(loaded.state, fresh, Date.now() / 1000);
  if (sameSessionState(merged, loaded.state)) {
    await deps.supplierSessions.markVerified(supplierId);
    return "unchanged";
  }
  const saved = await deps.supplierSessions.refresh(supplierId, loaded.sealed.iv, sealSessionState(merged, deps.key, loaded.sealed.keyId), merged);
  if (!saved) return "stale";
  await deps.audit.record({ action: "supplier.session_refreshed", entityType: "supplier", entityId: supplierId });
  return "saved";
}
