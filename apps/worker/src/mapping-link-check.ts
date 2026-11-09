import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient } from "@stock-monitor/browser-client";
import type { createMappingRepository, createSupplierRepository, createSupplierSessionRepository, LinkCheckResult, MappingRow, SupplierRecord } from "@stock-monitor/db";
import { decideLinkStatus, isSupplierWide, whyNotChecked, type CheckGateReason, type LinkState, type LinkStatus, type Observation } from "@stock-monitor/mapping";
import { unsealSessionState } from "@stock-monitor/supplier-session";

export type LinkCheckDeps = {
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  audit: ReturnType<typeof createAuditWriter>;
  browser: BrowserClient;
  /** Opens saved sessions. The browser service never has it. */
  key: Buffer;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export type SkipReason = CheckGateReason | "no_mapping" | "no_supplier" | "link_off";
export type LinkOutcome = { kind: "skipped"; reason: SkipReason } | { kind: "checked"; status: LinkStatus };
export type SupplierRunOutcome = { kind: "skipped"; reason: SkipReason } | { kind: "done"; checked: number; supplierWide: boolean };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const toState = (m: MappingRow): LinkState => ({
  status: m.linkStatus,
  lastWorkedAt: m.lastWorkedAt,
  workedTitle: m.workedTitle,
  workedHeading: m.workedHeading,
  missingChecks: m.missingChecks,
  firstMissingAt: m.firstMissingAt,
  checkedAt: m.lastLinkCheckAt,
});

/**
 * Link checks only ever say what happened to the LINK. They never read stock, never change the supplier's own
 * status or raise its notifications (the session check does that), and never put an address, a session or page
 * text in a log, an audit event or a job.
 */
export function createLinkChecker(deps: LinkCheckDeps) {
  const { mappings, suppliers, supplierSessions, audit, browser, logger } = deps;
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
    const sealed = await supplierSessions.getSealed(supplier.id);
    let state;
    try {
      state = sealed ? unsealSessionState(sealed, deps.key) : null;
    } catch {
      state = null;
    }
    // A session that cannot be opened cannot be used. That is the session check's business, so nothing is concluded here.
    if (!state) return { result: "service_unavailable", status: null, finalUrl: null, title: null, heading: null, softNotFound: false };
    const outcome = await browser.checkPage({ url: mapping.url, loginUrl: supplier.loginUrl ?? undefined, state });
    if (!outcome.ok) {
      logger.warn({ mappingId: mapping.id }, "link check could not run: the browser service did not answer");
      return { result: "service_unavailable", status: null, finalUrl: null, title: null, heading: null, softNotFound: false };
    }
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
      return { kind: "checked", status: await save(gated.supplier, mapping, await observe(gated.supplier, mapping), false) };
    },

    /**
     * Every enabled link of one supplier, one page at a time, waiting the supplier's own pause between pages.
     * The supplier is looked at again before each page, because it can be paused or deleted while the run waits.
     * Results are saved at the end, so a run where many links went missing at once can be recognised as a
     * supplier-wide problem and counted against none of them.
     */
    async checkSupplierLinks(supplierId: string): Promise<SupplierRunOutcome> {
      const first = await gate(supplierId);
      if ("reason" in first) return { kind: "skipped", reason: first.reason };
      const links = (await mappings.forSupplier(supplierId)).filter((m) => m.enabled);
      const seen: { mapping: MappingRow; observation: Observation }[] = [];
      for (const [index, mapping] of links.entries()) {
        if (index > 0) await sleep(first.supplier.checkPauseSeconds * 1000);
        const gated = await gate(supplierId);
        if ("reason" in gated) break;
        seen.push({ mapping, observation: await observe(gated.supplier, mapping) });
      }
      // What each link would be on its own, to see whether the run as a whole looks like a site change or outage.
      const trial = seen.map(({ mapping, observation }) =>
        decideLinkStatus(toState(mapping), observation, { requestedUrl: mapping.url, homeUrl: first.supplier.websiteUrl, now: now(), supplierWide: false }).status,
      );
      const supplierWide = isSupplierWide(trial);
      for (const { mapping, observation } of seen) await save(first.supplier, mapping, observation, supplierWide);
      return { kind: "done", checked: seen.length, supplierWide };
    },
  };
}

// The standalone functions the tests and the job handlers call.
export const checkLink = (deps: LinkCheckDeps, mappingId: string) => createLinkChecker(deps).checkLink(mappingId);
export const checkSupplierLinks = (deps: LinkCheckDeps, supplierId: string) => createLinkChecker(deps).checkSupplierLinks(supplierId);

/** The `mapping.link.check` and `mapping.links.check` jobs. Their payloads are only an id. */
export function createLinkCheckHandlers(deps: LinkCheckDeps) {
  return {
    async link(payload: { mappingId: string }): Promise<void> {
      const outcome = await checkLink(deps, payload.mappingId);
      deps.logger.info({ mappingId: payload.mappingId, outcome: outcome.kind, ...(outcome.kind === "skipped" ? { reason: outcome.reason } : { status: outcome.status }) }, "link check finished");
    },
    async links(payload: { supplierId: string }): Promise<void> {
      const outcome = await checkSupplierLinks(deps, payload.supplierId);
      deps.logger.info({ supplierId: payload.supplierId, outcome: outcome.kind, ...(outcome.kind === "skipped" ? { reason: outcome.reason } : { checked: outcome.checked, supplierWide: outcome.supplierWide }) }, "supplier link check finished");
    },
  };
}
