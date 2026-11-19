import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient } from "@stock-monitor/browser-client";
import type { Queue } from "@stock-monitor/queue";
import { runExpirySeconds } from "@stock-monitor/scheduling";
import type {
  createCheckRunRepository, createRecipeRepository, createMappingRepository, createNotificationRepository, createSupplierCredentialsRepository, createSupplierRepository, createSupplierSessionRepository, NotificationReason,
} from "@stock-monitor/db";
import { whyNotChecked } from "@stock-monitor/mapping";
import { unsealSessionState, type PageClass, type SessionState } from "@stock-monitor/supplier-session";
import { ensureLoggedIn, loginCheckUrl, type AutoLoginDeps } from "./auto-login.js";
import { saveRefreshedSession } from "./session-refresh.js";
import { stockGate } from "./extraction-check.js";

export type SupplierVerifyDeps = {
  /** Reads emailed login codes for automatic login. */
  codes?: AutoLoginDeps["codes"];
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
  /** For the re-run after a hand login. Without it, the check after a hand login only checks. */
  rerun?: { checkRuns: ReturnType<typeof createCheckRunRepository>; recipes: ReturnType<typeof createRecipeRepository>; queue: Pick<Queue, "enqueue"> };
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
  /** not_checked: a keep-alive visit for a supplier paused or refused after it was queued. */
  | { kind: "skipped"; reason: "no_supplier" | "no_session" | "not_checked" | "no_login" }
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
  supplier: { id: string; name: string; needsLogin?: boolean },
  result: AttentionReason,
): Promise<void> {
  await deps.suppliers.markNeedsAttention(supplier.id, STATUS[result]);
  // "Log in again" makes no sense for a supplier set to need no login: the setting may be wrong, so say that.
  const message =
    supplier.needsLogin === false && result === "login_required"
      ? `${supplier.name} showed a login page, but it is set to need no login. Open one of its links to see why, or turn Needs a login back on.`
      : MESSAGES[result](supplier.name);
  await deps.notifications.raise({ kind: "supplier_needs_reconnect", supplierId: supplier.id, message, reason: result });
}

/**
 * Checks that one supplier's saved session still works: opens it in a throw-away browser, and acts on
 * what the page was. A supplier that cannot be reached is tried again before anything is decided, and an
 * unreachable supplier alone never marks a session broken.
 */
export async function verifySupplierSession(deps: SupplierVerifyDeps, supplierId: string, options: { early?: boolean; login?: boolean; keepAlive?: boolean; afterLogin?: boolean } = {}): Promise<CheckOutcome> {
  const { suppliers, supplierSessions, notifications, audit, browser, logger } = deps;
  const supplier = await suppliers.get(supplierId);
  if (!supplier) return { kind: "skipped", reason: "no_supplier" };
  // No login to check: a session kept from before the setting changed is never opened.
  if (!supplier.needsLogin) return { kind: "skipped", reason: "no_login" };

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
  if (options.keepAlive && whyNotChecked(supplier, true)) return { kind: "skipped", reason: "not_checked" };
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
      if (options.afterLogin && deps.rerun) await rerunAfterLogin(deps, deps.rerun, supplierId);
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

/** A run only ever stops for a login with one of these. A failed automatic login maps to one of them. */
const LOGIN_STOPS = new Set(["login_required", "captcha", "blocked"]);

/**
 * After a hand login that proved good: runs again a check the login problem stopped. With automatic checks on, the next
 * check moves to now and the tick starts it (its window and the 2-at-once limit apply). With them off, the run starts here,
 * the same way Check all stock starts one.
 */
async function rerunAfterLogin(deps: SupplierVerifyDeps, rerun: NonNullable<SupplierVerifyDeps["rerun"]>, supplierId: string): Promise<void> {
  const last = (await rerun.checkRuns.recent(supplierId, 2)).find((r) => r.endedAt);
  if (!last || last.outcome !== "stopped" || !LOGIN_STOPS.has(last.stopReason ?? "")) return;
  const gated = await stockGate({ suppliers: deps.suppliers, supplierSessions: deps.supplierSessions, recipes: rerun.recipes }, supplierId);
  if ("reason" in gated) return;
  const { supplier } = gated;
  const audit = (details: Record<string, unknown>) => deps.audit.record({ action: "supplier.rerun_queued", entityType: "supplier", entityId: supplierId, details });
  if (supplier.scheduleIntervalMinutes) {
    const now = new Date();
    if (supplier.nextCheckAt && supplier.nextCheckAt <= now) return; // already due: the tick starts it
    await deps.suppliers.recordRunEnd(supplierId, { nextCheckAt: now, failureCount: supplier.failureCount });
    await audit({ how: "schedule" });
    return;
  }
  const links = (await deps.mappings.forSupplier(supplierId)).filter((m) => m.enabled).length;
  if (links === 0) return;
  const run = await rerun.checkRuns.start(supplierId, "manual", links);
  if (!run) return; // a run is already going
  try {
    await rerun.queue.enqueue("extraction.checks", { supplierId, runId: run.id }, { expireInSeconds: runExpirySeconds(links, supplier.checkPauseSeconds), retryLimit: 0 });
  } catch {
    await rerun.checkRuns.end(run.id, "failed", "not_queued");
    deps.logger.warn({ supplierId }, "the run after a hand login could not be queued");
    return;
  }
  await audit({ how: "started", runId: run.id });
}

/**
 * The `supplier.session.verify` job. The payload is the supplier's id, `early` for the check the scheduler queues before
 * a run, `login` for the owner's "Check login" button, and `keepAlive` for the visit that keeps an idle login from timing out.
 */
export function createSupplierVerifyHandler(deps: SupplierVerifyDeps) {
  return async function handleSupplierVerify(payload: { supplierId: string; early?: true; login?: true; keepAlive?: true; afterLogin?: true }): Promise<void> {
    const outcome = await verifySupplierSession(deps, payload.supplierId, { early: payload.early === true, login: payload.login === true, keepAlive: payload.keepAlive === true, afterLogin: payload.afterLogin === true });
    deps.logger.info({ supplierId: payload.supplierId, outcome: outcome.kind, ...(outcome.kind === "needs_attention" && { result: outcome.result }) }, "session check finished");
  };
}
