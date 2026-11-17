import { KEY_ID } from "@stock-monitor/crypto";
import type { BrowserClient, LoginResult } from "@stock-monitor/browser-client";
import type {
  createCheckRunRepository, createMappingRepository, createNotificationRepository, createSupplierCredentialsRepository, createSupplierRepository, SupplierRecord,
} from "@stock-monitor/db";
import { insideWindow } from "@stock-monitor/scheduling";
import { sealSessionState, unsealCredentials, type SessionState } from "@stock-monitor/supplier-session";
import type { StopReason } from "./extraction-check.js";
import type { SessionRefreshDeps } from "./session-refresh.js";
import { raiseNeedsAttention, type AttentionReason } from "./supplier-verify.js";

/** A session checked this recently is used as it is, unless the caller forces a login. */
export const AUTO_LOGIN_FRESH_MINUTES = 10;

export type AutoLoginDeps = SessionRefreshDeps & {
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierCredentials: ReturnType<typeof createSupplierCredentialsRepository>;
  browser: BrowserClient;
  notifications: ReturnType<typeof createNotificationRepository>;
  now?: () => Date;
};

type Outcome = Parameters<ReturnType<typeof createSupplierRepository>["recordAutoLogin"]>[2];

/** What each failed login means: the failure count change, what the run stops with, and the notice the owner sees. */
const FAILED: Record<Exclude<LoginResult, "ok" | "unreachable">, { outcome: Outcome; stop: StopReason; notice: AttentionReason }> = {
  captcha: { outcome: "failed", stop: "captcha", notice: "captcha" },
  code_required: { outcome: "failed", stop: "login_required", notice: "code_required" },
  blocked: { outcome: "failed", stop: "blocked", notice: "blocked" },
  form_not_found: { outcome: "failed", stop: "login_required", notice: "form_not_found" },
  unknown: { outcome: "failed", stop: "login_required", notice: "login_required" },
  wrong_password: { outcome: "pause_wrong_password", stop: "login_required", notice: "wrong_password" },
  account_locked: { outcome: "pause_account_locked", stop: "blocked", notice: "account_locked" },
};

/**
 * Logs the supplier in with its saved credentials when automatic login is on and the session is not known to be fresh.
 * One attempt, never retried here. The credentials go to the browser service only; nothing logged or audited holds them.
 */
export async function ensureLoggedIn(deps: AutoLoginDeps, supplier: SupplierRecord, opts: { force: boolean; checkUrl: string }): Promise<"ready" | "skipped" | StopReason> {
  if (!supplier.autoLogin || supplier.autoLoginPausedReason) return "skipped";
  const { suppliers, supplierSessions, logger } = deps;
  const id = supplier.id;
  const now = deps.now ?? (() => new Date());

  const finish = async (result: LoginResult, outcome: Outcome) => {
    await suppliers.recordAutoLogin(id, result, outcome);
    await deps.audit.record({ action: "supplier.auto_login", entityType: "supplier", entityId: id, details: { result, stealth: supplier.stealth } });
  };

  try {
    if (!opts.force) {
      const verified = (await supplierSessions.facts(id))?.lastVerifiedAt;
      if (verified && now().getTime() - verified.getTime() < AUTO_LOGIN_FRESH_MINUTES * 60_000) return "ready";
    }
    const sealedCredentials = await deps.supplierCredentials.getSealed(id);
    if (!sealedCredentials) {
      logger.warn({ supplierId: id }, "automatic login is on but there are no saved credentials");
      return "skipped";
    }
    const credentials = unsealCredentials(sealedCredentials, deps.key);
    // Which login is stored now. A login the owner makes while this one runs changes it, and then wins.
    const expectedIv = (await supplierSessions.getSealed(id))?.iv ?? null;

    const call = await deps.browser.login({
      loginUrl: supplier.loginUrl ?? supplier.websiteUrl,
      checkUrl: opts.checkUrl,
      username: credentials.username,
      password: credentials.password,
      ...(credentials.account ? { account: credentials.account } : {}),
      stealth: supplier.stealth,
      selectors: supplier.loginSelectors ?? undefined,
    });
    if (!call.ok && call.reason === "not_supported") {
      // The browser service is not in profile mode: the run carries on as it would without automatic login.
      logger.warn({ supplierId: id, reason: call.reason }, "automatic login skipped: the browser service does not log in (VERIFY_MODE is not profile)");
      return "skipped";
    }
    if (!call.ok) {
      // Our own browser service, not the supplier: nothing counts against the login.
      logger.warn({ supplierId: id, reason: call.reason }, "automatic login could not run: the browser service did not answer");
      await finish("unreachable", "unchanged");
      return "unreachable";
    }

    const { result, state } = call.outcome;
    if (result === "ok" && state) {
      await saveLogin(deps, id, expectedIv, state);
      await finish("ok", "reset");
      return "ready";
    }
    if (result === "unreachable") {
      await finish("unreachable", "unchanged");
      return "unreachable";
    }
    // An ok with no session to keep is not a login we can use.
    const failed = FAILED[result === "ok" ? "unknown" : result];
    await finish(result === "ok" ? "unknown" : result, failed.outcome);
    await raiseNeedsAttention(deps, supplier, failed.notice);
    return failed.stop;
  } catch (error) {
    // The error's name only: a message could hold the login.
    logger.error({ supplierId: id, err: error instanceof Error ? error.name : "unknown" }, "automatic login failed");
    await finish("unreachable", "unchanged").catch(() => undefined);
    return "unreachable";
  }
}

/** A new login replaces the stored session, unless the owner logged in since the attempt started. */
async function saveLogin(deps: AutoLoginDeps, id: string, expectedIv: string | null, state: SessionState): Promise<void> {
  const sealed = sealSessionState(state, deps.key, KEY_ID);
  const saved = expectedIv === null ? await deps.supplierSessions.saveIfAbsent(id, sealed, state) : await deps.supplierSessions.refresh(id, expectedIv, sealed, state);
  if (!saved) deps.logger.info({ supplierId: id }, "kept the owner's newer login");
  await deps.supplierSessions.markVerified(id);
  await deps.suppliers.markVerified(id);
  await deps.notifications.resolve("supplier_needs_reconnect", id);
}

/** The address a login is checked on: the first enabled link (the home page may not need a login), else the website. */
export function loginCheckUrl(supplier: SupplierRecord, links: { url: string; enabled: boolean }[]): string {
  return links.find((l) => l.enabled)?.url ?? supplier.websiteUrl;
}

export type AutoLoginTestDeps = AutoLoginDeps & {
  checkRuns: ReturnType<typeof createCheckRunRepository>;
  mappings: ReturnType<typeof createMappingRepository>;
  /** The owner's timezone, for the supplier's quiet hours. */
  timezone: string;
};
export type AutoLoginTestOutcome =
  | { kind: "skipped"; reason: "no_supplier" | "no_permission" | "no_credentials" | "quiet_hours" | "run_going" }
  | { kind: "done"; result: Awaited<ReturnType<typeof ensureLoggedIn>> };

/** The `supplier.session.login` job ("Test login now"): one forced login and nothing else. A refusal is logged by its reason only. */
export function createAutoLoginTestHandler(deps: AutoLoginTestDeps) {
  const now = deps.now ?? (() => new Date());
  return async (payload: { supplierId: string }): Promise<AutoLoginTestOutcome> => {
    const { supplierId } = payload;
    const refuse = (reason: Extract<AutoLoginTestOutcome, { kind: "skipped" }>["reason"]): AutoLoginTestOutcome => {
      deps.logger.warn({ supplierId, reason }, "test login refused");
      return { kind: "skipped", reason };
    };
    const supplier = await deps.suppliers.get(supplierId);
    if (!supplier) return refuse("no_supplier");
    if (supplier.automationPermission !== "granted") return refuse("no_permission");
    if (!(await deps.supplierCredentials.getSealed(supplierId))) return refuse("no_credentials");
    const window = supplier.scheduleWindowStart && supplier.scheduleWindowEnd ? { start: supplier.scheduleWindowStart, end: supplier.scheduleWindowEnd } : null;
    if (!insideWindow(now(), window, deps.timezone)) return refuse("quiet_hours");
    if (await deps.checkRuns.current(supplierId)) return refuse("run_going");
    const result = await ensureLoggedIn(deps, supplier, { force: true, checkUrl: loginCheckUrl(supplier, await deps.mappings.forSupplier(supplierId)) });
    deps.logger.info({ supplierId, result }, "test login finished");
    return { kind: "done", result };
  };
}
