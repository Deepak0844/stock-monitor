import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient } from "@stock-monitor/browser-client";
import type {
  createMappingRepository, createNotificationRepository, createSupplierCredentialsRepository, createSupplierRepository, createSupplierSessionRepository, NotificationReason,
} from "@stock-monitor/db";
import { unsealSessionState, type PageClass, type SessionState } from "@stock-monitor/supplier-session";
import { ensureLoggedIn, loginCheckUrl } from "./auto-login.js";
import { saveRefreshedSession } from "./session-refresh.js";

export type SupplierVerifyDeps = {
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  /** The saved login and the links, for a supplier with automatic login: its check is a login. */
  supplierCredentials: ReturnType<typeof createSupplierCredentialsRepository>;
  mappings: ReturnType<typeof createMappingRepository>;
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
/** The reasons a session needs attention. (The other reason, page_changed, belongs to stock rules.) */
export type AttentionReason = Exclude<NotificationReason, "page_changed">;
/** The reasons a session check can raise. The rest are raised by the automatic login. */
export type SessionReason = Exclude<AttentionReason, "code_required" | "wrong_password" | "account_locked" | "form_not_found">;

export type CheckOutcome =
  | { kind: "skipped"; reason: "no_supplier" | "no_session" }
  | { kind: "ok" }
  | { kind: "needs_attention"; result: SessionReason }
  /** An early check found a page it could not read clearly. Nothing is marked: the run does not stop on one either. */
  | { kind: "unclear" }
  | { kind: "unreachable" }
  | { kind: "service_unavailable" };

const DEFAULT_RETRY_DELAYS_MS = [10_000, 60_000];

// What the owner reads. Plain words, and the supplier's name, never an exception name or a secret.
const MESSAGES: Record<AttentionReason, (name: string) => string> = {
  login_required: (name) => `${name} needs you to log in again.`,
  captcha: (name) => `${name} is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it.`,
  blocked: (name) => `${name} is refusing our automated checks, even though your login may have worked. It stays paused. Ask the supplier for a price list or feed, or reconnect to try again.`,
  unknown: (name) => `We could not tell whether ${name} is still logged in. Reconnect the supplier to be sure.`,
  code_required: () => "The supplier asked for a code. Log in in the live window and type it there.",
  wrong_password: () => "The supplier refused the saved password. Automatic login is paused until you save it again.",
  account_locked: () => "The supplier says the account is locked. Automatic login is paused. Unlock it on the supplier's site, then press Resume.",
  form_not_found: () => "Automatic login could not find the login form. Set the login page fields on the supplier page.",
};

/** A challenge or a block is shown as Blocked. A login or an unclear page as Needs reconnecting. */
const STATUS = {
  login_required: "needs_reconnect",
  unknown: "needs_reconnect",
  captcha: "blocked",
  blocked: "blocked",
  code_required: "needs_reconnect",
  wrong_password: "needs_reconnect",
  form_not_found: "needs_reconnect",
  account_locked: "blocked",
} as const;

/** Marks the supplier as needing attention and tells the owner on the dashboard. Used by session checks and by stock runs that meet a login, puzzle or block. */
export async function raiseNeedsAttention(
  deps: Pick<SupplierVerifyDeps, "suppliers" | "notifications">,
  supplier: { id: string; name: string },
  result: AttentionReason,
): Promise<void> {
  await deps.suppliers.markNeedsAttention(supplier.id, STATUS[result]);
  await deps.notifications.raise({ kind: "supplier_needs_reconnect", supplierId: supplier.id, message: MESSAGES[result](supplier.name), reason: result });
}

/**
 * Checks that one supplier's saved session still works: opens it in a throw-away browser, and acts on
 * what the page was. A supplier that cannot be reached is tried again before anything is decided, and an
 * unreachable supplier alone never marks a session broken.
 */
export async function verifySupplierSession(deps: SupplierVerifyDeps, supplierId: string, options: { early?: boolean; login?: boolean; keepAlive?: boolean } = {}): Promise<CheckOutcome> {
  const { suppliers, supplierSessions, notifications, audit, browser, logger } = deps;
  const supplier = await suppliers.get(supplierId);
  if (!supplier) return { kind: "skipped", reason: "no_supplier" };

  // The HTTP status tells us why a check was refused (403 vs 429 vs a challenge page). Never page text.
  let httpStatus: number | null = null;
  const record = (result: string) => audit.record({ action: "supplier.session_checked", entityType: "supplier", entityId: supplierId, details: { result, httpStatus, ...(options.keepAlive && { keepAlive: true }) } });

  // The owner's "Check login" button, with automatic login on, is a fresh login: an old session that timed out must not
  // pause the supplier. The check after a live-window login stays plain, or a code or puzzle supplier would fail a forced
  // login seconds after the owner fixed it by hand.
  const canLogIn = supplier.autoLogin && !supplier.autoLoginPausedReason;
  /** A forced login. Undefined when it was skipped, so the caller goes on as without one. */
  const logIn = async (): Promise<CheckOutcome | undefined> => {
    const login = await ensureLoggedIn(deps, supplier, { force: true, checkUrl: loginCheckUrl(supplier, await deps.mappings.forSupplier(supplierId)) });
    if (login === "ready") {
      await record("ok");
      return { kind: "ok" };
    }
    if (login === "login_required" || login === "captcha" || login === "blocked") {
      // The login already raised its own notice, which says more than a plain "log in again".
      await record(login);
      return { kind: "needs_attention", result: login };
    }
    if (login !== "skipped") {
      await suppliers.touchChecked(supplierId);
      await record("unreachable");
      return { kind: "unreachable" };
    }
    return undefined;
  };
  if (options.login && canLogIn) {
    const done = await logIn();
    if (done) return done;
  }

  const sealed = await supplierSessions.getSealed(supplierId);
  if (!sealed) return { kind: "skipped", reason: "no_session" };
  const needsAttention = async (result: SessionReason): Promise<CheckOutcome> => {
    await raiseNeedsAttention(deps, supplier, result);
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
  let fresh: SessionState | undefined;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1] as number);
    const outcome = await browser.verify({ url: supplier.websiteUrl, loginUrl: supplier.loginUrl ?? undefined, ...(supplier.loggedInMarker ? { loggedInMarker: supplier.loggedInMarker } : {}), state, ...(supplier.stealth ? { stealth: true } : {}) });
    result = outcome.ok ? outcome.result : "service_unavailable";
    fresh = outcome.ok ? outcome.state : undefined;
    httpStatus = outcome.ok ? outcome.status : null;
    if (result !== "unreachable" && result !== "service_unavailable") break; // a clear answer
  }

  switch (result) {
    case "ok":
      await suppliers.markVerified(supplierId);
      // Keeps a session the supplier extended, and records the check either way.
      if ((await saveRefreshedSession(deps, supplierId, { sealed, state }, fresh)) === "none") await supplierSessions.markVerified(supplierId);
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
      // A keep-alive visit that finds the session gone logs in again by itself, when it may.
      if (options.keepAlive && result === "login_required" && canLogIn) {
        const done = await logIn();
        if (done) return done;
      }
      // The early check before a run, and a keep-alive visit, must not be stricter than the run, which does not stop on an unclear page.
      if ((options.early || options.keepAlive) && result === "unknown") {
        await record(result);
        return { kind: "unclear" };
      }
      return needsAttention(result);
  }
}

/**
 * The `supplier.session.verify` job. The payload is the supplier's id, `early` for the check the scheduler queues before
 * a run, `login` for the owner's "Check login" button, and `keepAlive` for the visit that keeps an idle login from timing out.
 */
export function createSupplierVerifyHandler(deps: SupplierVerifyDeps) {
  return async function handleSupplierVerify(payload: { supplierId: string; early?: true; login?: true; keepAlive?: true }): Promise<void> {
    const outcome = await verifySupplierSession(deps, payload.supplierId, { early: payload.early === true, login: payload.login === true, keepAlive: payload.keepAlive === true });
    deps.logger.info({ supplierId: payload.supplierId, outcome: outcome.kind, ...(outcome.kind === "needs_attention" && { result: outcome.result }) }, "session check finished");
  };
}
