import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient } from "@stock-monitor/browser-client";
import type { createNotificationRepository, createSupplierRepository, createSupplierSessionRepository, NotificationReason } from "@stock-monitor/db";
import { unsealSessionState, type PageClass } from "@stock-monitor/supplier-session";

export type SupplierVerifyDeps = {
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  notifications: ReturnType<typeof createNotificationRepository>;
  audit: ReturnType<typeof createAuditWriter>;
  browser: BrowserClient;
  /** Opens saved sessions. The browser service never has it. */
  key: Buffer;
  logger: Logger;
  /** How long to wait before each retry when the supplier cannot be reached. */
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

/**
 * What a check found. It is only ever about the session: a check that failed or was blocked says nothing
 * about stock, and nothing here could be mistaken for a stock figure.
 */
/** The reasons a session check can raise. (The other reason, page_changed, belongs to stock rules.) */
type SessionReason = Exclude<NotificationReason, "page_changed">;

export type CheckOutcome =
  | { kind: "skipped"; reason: "no_supplier" | "no_session" }
  | { kind: "ok" }
  | { kind: "needs_attention"; result: SessionReason }
  | { kind: "unreachable" }
  | { kind: "service_unavailable" };

const DEFAULT_RETRY_DELAYS_MS = [10_000, 60_000];

// What the owner reads. Plain words, and the supplier's name, never an exception name or a secret.
const MESSAGES: Record<SessionReason, (name: string) => string> = {
  login_required: (name) => `${name} needs you to log in again.`,
  captcha: (name) => `${name} is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it.`,
  blocked: (name) => `${name} is refusing our automated checks, even though your login may have worked. It stays paused. Ask the supplier for a price list or feed, or reconnect to try again.`,
  unknown: (name) => `We could not tell whether ${name} is still logged in. Reconnect the supplier to be sure.`,
};

/** A challenge or a block is shown as Blocked. A login or an unclear page as Needs reconnecting. */
const STATUS = { login_required: "needs_reconnect", unknown: "needs_reconnect", captcha: "blocked", blocked: "blocked" } as const;

/**
 * Checks that one supplier's saved session still works: opens it in a throw-away browser, and acts on
 * what the page was. A supplier that cannot be reached is tried again before anything is decided, and an
 * unreachable supplier alone never marks a session broken.
 */
export async function verifySupplierSession(deps: SupplierVerifyDeps, supplierId: string): Promise<CheckOutcome> {
  const { suppliers, supplierSessions, notifications, audit, browser, logger } = deps;
  const supplier = await suppliers.get(supplierId);
  if (!supplier) return { kind: "skipped", reason: "no_supplier" };
  const sealed = await supplierSessions.getSealed(supplierId);
  if (!sealed) return { kind: "skipped", reason: "no_session" };

  // The HTTP status tells us why a check was refused (403 vs 429 vs a challenge page). Never page text.
  let httpStatus: number | null = null;
  const record = (result: string) => audit.record({ action: "supplier.session_checked", entityType: "supplier", entityId: supplierId, details: { result, httpStatus } });
  const needsAttention = async (result: SessionReason): Promise<CheckOutcome> => {
    await suppliers.markNeedsAttention(supplierId, STATUS[result]);
    await notifications.raise({ kind: "supplier_needs_reconnect", supplierId, message: MESSAGES[result](supplier.name), reason: result });
    await record(result);
    return { kind: "needs_attention", result };
  };

  let state;
  try {
    state = unsealSessionState(sealed, deps.key);
  } catch {
    // A session that cannot be opened (a changed key, damaged data) cannot be used, so it needs a new login.
    logger.warn({ supplierId }, "saved session could not be read");
    return needsAttention("unknown");
  }

  const delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let result: PageClass | "service_unavailable" = "unreachable";
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1] as number);
    const outcome = await browser.verify({ url: supplier.websiteUrl, loginUrl: supplier.loginUrl ?? undefined, state });
    result = outcome.ok ? outcome.result : "service_unavailable";
    httpStatus = outcome.ok ? outcome.status : null;
    if (result !== "unreachable" && result !== "service_unavailable") break; // a clear answer
  }

  switch (result) {
    case "ok":
      await suppliers.markVerified(supplierId);
      await supplierSessions.markVerified(supplierId);
      await notifications.resolve("supplier_needs_reconnect", supplierId);
      await record("ok");
      return { kind: "ok" };
    case "unreachable":
      await suppliers.touchChecked(supplierId);
      await record("unreachable");
      return { kind: "unreachable" };
    case "service_unavailable":
      // Our own browser service, not the supplier. Nothing is paused and nobody is told the session is broken.
      logger.warn({ supplierId }, "session check could not run: the browser service did not answer");
      return { kind: "service_unavailable" };
    default:
      return needsAttention(result);
  }
}

/** The `supplier.session.verify` job. The payload is only the supplier's id. */
export function createSupplierVerifyHandler(deps: SupplierVerifyDeps) {
  return async function handleSupplierVerify(payload: { supplierId: string }): Promise<void> {
    const outcome = await verifySupplierSession(deps, payload.supplierId);
    deps.logger.info({ supplierId: payload.supplierId, outcome: outcome.kind, ...(outcome.kind === "needs_attention" && { result: outcome.result }) }, "session check finished");
  };
}
