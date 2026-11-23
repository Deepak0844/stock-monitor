import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient } from "@stock-monitor/browser-client";
import type {
  createCheckRunRepository, createMappingRepository, createNotificationRepository, createSupplierCredentialsRepository, createSupplierRepository, createSupplierSessionRepository, LinkCheckResult, MappingRow, SupplierRecord,
} from "@stock-monitor/db";
import { isCheckable } from "@stock-monitor/db";
import { decideLinkStatus, isSupplierWide, whyNotChecked, type CheckGateReason, type LinkState, type LinkStatus, type Observation } from "@stock-monitor/mapping";
import { unsealSessionState } from "@stock-monitor/supplier-session";
import { EMPTY_STATE, freshFor, loginFields } from "./supplier-visit.js";
import { ensureLoggedIn, loginCheckUrl, type AutoLoginDeps } from "./auto-login.js";
import { saveRefreshedSession } from "./session-refresh.js";
import { raiseNeedsAttention, type StopReason } from "./needs-attention.js";

export type LinkCheckDeps = {
  /** Reads emailed login codes for automatic login. */
  codes?: AutoLoginDeps["codes"];
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  /** The saved login, for automatic login. */
  supplierCredentials: ReturnType<typeof createSupplierCredentialsRepository>;
  notifications: ReturnType<typeof createNotificationRepository>;
  /** The run record a whole-supplier run reports its progress and end to. */
  checkRuns: ReturnType<typeof createCheckRunRepository>;
  audit: ReturnType<typeof createAuditWriter>;
  browser: BrowserClient;
  /** Opens saved sessions. The browser service never has it. */
  key: Buffer;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export type SkipReason = CheckGateReason | "no_mapping" | "no_supplier" | "link_off" | "run_ended";
export type LinkOutcome = { kind: "skipped"; reason: SkipReason } | { kind: "checked"; status: LinkStatus };
/** `stopped` is set when an automatic login failed and ended the run. */
export type SupplierRunOutcome = { kind: "skipped"; reason: SkipReason } | { kind: "done"; checked: number; supplierWide: boolean; stopped?: StopReason };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const toState = (m: MappingRow): LinkState => ({
  status: m.linkStatus,
  lastWorkedAt: m.lastWorkedAt,
  workedTitle: m.workedTitle,
  workedHeading: m.workedHeading,
  missingChecks: m.missingChecks,
  firstMissingAt: m.firstMissingAt,
  checkedAt: m.lastLinkCheckAt,
});

/**
 * Link checks only ever say what happened to the LINK. They never read stock and never put an address, a session or
 * page text in a log, an audit event or a job. The one thing they do beyond the link: a page that asked for a login,
 * showed a puzzle or refused us means the supplier's session is no good, so the supplier is marked as needing the
 * owner, exactly as a failed session check would (the home page the session check reads can look fine while the
 * pages behind the login do not).
 */
export function createLinkChecker(deps: LinkCheckDeps) {
  const { mappings, suppliers, supplierSessions, checkRuns, audit, browser, logger } = deps;
  const needsOwner = (result: string): result is "login_required" | "captcha" | "blocked" => result === "login_required" || result === "captcha" || result === "blocked";
  const sleep = deps.sleep ?? wait;
  const now = deps.now ?? (() => new Date());

  /** The supplier, and a plain reason when its links must not be checked right now. */
  async function gate(supplierId: string): Promise<{ supplier: SupplierRecord } | { reason: SkipReason }> {
    const supplier = await suppliers.get(supplierId);
    if (!supplier) return { reason: "no_supplier" };
    const refused = whyNotChecked(supplier, (await supplierSessions.getSealed(supplierId)) !== null);
    return refused ? { reason: refused.reason } : { supplier };
  }

  /** Opens one page with the supplier's saved session and says what was seen. */
  async function observe(supplier: SupplierRecord, mapping: MappingRow): Promise<Observation> {
    // A supplier that needs no login is visited with no session at all.
    const sealed = supplier.needsLogin ? await supplierSessions.getSealed(supplier.id) : null;
    let state;
    try {
      state = !supplier.needsLogin ? EMPTY_STATE : sealed ? unsealSessionState(sealed, deps.key) : null;
    } catch {
      state = null;
    }
    // A session that cannot be opened cannot be used. That is the session check's business, so nothing is concluded here.
    if (!state) return { result: "service_unavailable", status: null, finalUrl: null, title: null, heading: null, softNotFound: false };
    const outcome = await browser.checkPage({ url: mapping.url, ...loginFields(supplier), state, ...(supplier.stealth ? { stealth: true } : {}), ...(freshFor(supplier) ? { freshProfile: true } : {}) });
    if (!outcome.ok) {
      logger.warn({ mappingId: mapping.id }, "link check could not run: the browser service did not answer");
      return { result: "service_unavailable", status: null, finalUrl: null, title: null, heading: null, softNotFound: false };
    }
    if (sealed && outcome.result === "ok") await saveRefreshedSession(deps, supplier.id, { sealed, state }, outcome.state);
    return { result: outcome.result, status: outcome.status, finalUrl: outcome.finalUrl, title: outcome.title, heading: outcome.heading, softNotFound: outcome.softNotFound };
  }

  async function save(supplier: SupplierRecord, mapping: MappingRow, observation: Observation, supplierWide: boolean): Promise<LinkStatus> {
    const next: LinkCheckResult = decideLinkStatus(toState(mapping), observation, {
      requestedUrl: mapping.url,
      homeUrl: supplier.websiteUrl,
      now: now(),
      supplierWide,
    });
    await mappings.recordCheck(mapping.id, next);
    await audit.record({ action: "mapping.link_checked", entityType: "mapping", entityId: mapping.id, details: { status: next.status } });
    return next.status;
  }

  return {
    async checkLink(mappingId: string): Promise<LinkOutcome> {
      const mapping = await mappings.get(mappingId);
      if (!mapping) return { kind: "skipped", reason: "no_mapping" };
      if (!mapping.enabled) return { kind: "skipped", reason: "link_off" };
      const gated = await gate(mapping.supplierId);
      if ("reason" in gated) return { kind: "skipped", reason: gated.reason };
      // A failed automatic login already told the owner what went wrong, so the check must not replace that notice.
      let toldOwner = false;
      // A login that has just happened is not repeated if the very next page still asks for one: the supplier just accepted it.
      let loggedInNow = false;
      const login = await ensureLoggedIn(deps, gated.supplier, { force: false, checkUrl: mapping.url, onLoggedIn: () => void (loggedInNow = true) });
      let observation: Observation;
      if (login !== "ready" && login !== "skipped") {
        observation = { result: login === "supplier_not_ready" ? "unreachable" : login, status: null, finalUrl: null, title: null, heading: null, softNotFound: false };
        toldOwner = true;
      } else {
        observation = await observe(gated.supplier, mapping);
        if (observation.result === "login_required" && !loggedInNow) {
          const again = await ensureLoggedIn(deps, gated.supplier, { force: true, checkUrl: mapping.url });
          if (again === "ready") observation = await observe(gated.supplier, mapping);
          else if (again !== "skipped") toldOwner = true;
        }
      }
      const status = await save(gated.supplier, mapping, observation, false);
      if (!toldOwner && needsOwner(observation.result)) await raiseNeedsAttention(deps, gated.supplier, observation.result);
      return { kind: "checked", status };
    },

    /**
     * Every enabled link of one supplier, one page at a time, waiting the supplier's own pause between pages.
     * The supplier is looked at again before each page, because it can be paused or deleted while the run waits.
     * Results are saved at the end, so a run where many links went missing at once can be recognised as a
     * supplier-wide problem and counted against none of them.
     */
    async checkSupplierLinks(supplierId: string, runId?: string): Promise<SupplierRunOutcome> {
      try {
        return await runLinks(supplierId, runId);
      } catch (error) {
        if (runId) await checkRuns.end(runId, "failed", "error");
        throw error;
      }
    },
  };

  /** `runId` is left out only by a job queued before link runs were recorded. */
  async function runLinks(supplierId: string, runId?: string): Promise<SupplierRunOutcome> {
    const first = await gate(supplierId);
    if ("reason" in first) {
      if (runId) await checkRuns.end(runId, "stopped", "supplier_not_ready");
      return { kind: "skipped", reason: first.reason };
    }
    // A job left queued over a restart: its run was already ended. It must not visit anything.
    if (runId && !(await checkRuns.isRunning(runId))) return { kind: "skipped", reason: "run_ended" };
    const links = (await mappings.forSupplier(supplierId)).filter(isCheckable);
    const seen: { mapping: MappingRow; observation: Observation }[] = [];
    const checkUrl = loginCheckUrl(first.supplier, links);
    // A failed automatic login already told the owner, and ends the run.
    let stopped: StopReason | undefined;
    // A login at the start of the run is not repeated if the first page still asks for one: the supplier just accepted it.
    let loggedInAtStart = false;
    if (links.length > 0) {
      const login = await ensureLoggedIn(deps, first.supplier, { force: false, checkUrl, onLoggedIn: () => void (loggedInAtStart = true) });
      if (login !== "ready" && login !== "skipped") stopped = login;
    }
    // One automatic login when a page asks for one, at most, per run.
    let loggedInAgain = false;
    // Paused or no longer allowed while the run waited.
    let notReady = false;
    for (const [index, mapping] of stopped ? [] : links.entries()) {
      if (index > 0) await sleep(first.supplier.checkPauseSeconds * 1000);
      const gated = await gate(supplierId);
      if ("reason" in gated) {
        notReady = true;
        break;
      }
      let observation = await observe(gated.supplier, mapping);
      if (observation.result === "login_required" && !loggedInAgain && !loggedInAtStart) {
        loggedInAgain = true;
        const login = await ensureLoggedIn(deps, gated.supplier, { force: true, checkUrl });
        if (login === "ready") observation = await observe(gated.supplier, mapping);
        else if (login !== "skipped") stopped = login;
      }
      if (observation.result !== "login_required") loggedInAtStart = false;
      seen.push({ mapping, observation });
      if (runId) await checkRuns.progress(runId, { linksDone: seen.length, inStock: 0, outOfStock: 0, cannotTell: 0 });
      if (stopped) break;
    }
    // What each link would be on its own, to see whether the run as a whole looks like a site change or outage.
    const trial = seen.map(({ mapping, observation }) =>
      decideLinkStatus(toState(mapping), observation, { requestedUrl: mapping.url, homeUrl: first.supplier.websiteUrl, now: now(), supplierWide: false }).status,
    );
    const supplierWide = isSupplierWide(trial);
    for (const { mapping, observation } of seen) await save(first.supplier, mapping, observation, supplierWide);
    const refused = seen.map((s) => s.observation.result).find(needsOwner);
    if (refused && !stopped) await raiseNeedsAttention(deps, first.supplier, refused);
    const stopReason = stopped ?? (notReady ? "supplier_not_ready" : null);
    if (runId) await checkRuns.end(runId, stopReason ? "stopped" : "finished", stopReason);
    return { kind: "done", checked: seen.length, supplierWide, ...(stopped ? { stopped } : {}) };
  }
}

// The standalone functions the tests and the job handlers call.
export const checkLink = (deps: LinkCheckDeps, mappingId: string) => createLinkChecker(deps).checkLink(mappingId);
export const checkSupplierLinks = (deps: LinkCheckDeps, supplierId: string, runId?: string) => createLinkChecker(deps).checkSupplierLinks(supplierId, runId);

/** The `mapping.link.check` and `mapping.links.check` jobs. Their payloads are only an id. */
export function createLinkCheckHandlers(deps: LinkCheckDeps) {
  return {
    async link(payload: { mappingId: string }): Promise<void> {
      const outcome = await checkLink(deps, payload.mappingId);
      deps.logger.info({ mappingId: payload.mappingId, outcome: outcome.kind, ...(outcome.kind === "skipped" ? { reason: outcome.reason } : { status: outcome.status }) }, "link check finished");
    },
    async links(payload: { supplierId: string; runId?: string }): Promise<void> {
      const outcome = await checkSupplierLinks(deps, payload.supplierId, payload.runId);
      deps.logger.info({ supplierId: payload.supplierId, runId: payload.runId ?? null, outcome: outcome.kind, ...(outcome.kind === "skipped" ? { reason: outcome.reason } : { checked: outcome.checked, supplierWide: outcome.supplierWide, stopped: outcome.stopped ?? null }) }, "supplier link check finished");
    },
  };
}
