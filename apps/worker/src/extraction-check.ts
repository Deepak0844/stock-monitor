import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient } from "@stock-monitor/browser-client";
import type {
  createCaptureRepository, createMappingRepository, createNotificationRepository, createObservationRepository, createRecipeRepository,
  createSupplierRepository, createSupplierSessionRepository, MappingRow, SupplierRecord,
} from "@stock-monitor/db";
import { decide, isSupplierWideChange, validateRecipe, type Answer, type Decision, type PageDescription, type Reason, type Recipe } from "@stock-monitor/extraction";
import { decideLinkStatus, isSupplierWide, whyNotChecked, type CheckGateReason, type LinkStatus, type Observation } from "@stock-monitor/mapping";
import { unsealSessionState } from "@stock-monitor/supplier-session";
import { toState } from "./mapping-link-check.js";

export type StockCheckDeps = {
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  recipes: ReturnType<typeof createRecipeRepository>;
  observations: ReturnType<typeof createObservationRepository>;
  captures: ReturnType<typeof createCaptureRepository>;
  notifications: ReturnType<typeof createNotificationRepository>;
  audit: ReturnType<typeof createAuditWriter>;
  browser: BrowserClient;
  /** Opens saved sessions. The browser service never has it. */
  key: Buffer;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export type SkipReason = CheckGateReason | "no_mapping" | "no_supplier" | "link_off" | "no_recipe";
export type StockOutcome = { kind: "skipped"; reason: SkipReason } | { kind: "checked"; answer: Answer; reason: Reason | null };
export type StockRunOutcome = { kind: "skipped"; reason: SkipReason } | { kind: "done"; checked: number; supplierWide: boolean };

type Active = { recipe: Recipe; version: number };
type Visit = { mapping: MappingRow; obs: Observation; page: PageDescription | null; picture: Buffer | null; checkResult: string; decision: Decision; linkTrial: LinkStatus };

const FAILED_VISIT = new Set(["login_required", "captcha", "blocked", "unreachable"]);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const tell = (reason: Reason): Decision => ({ answer: "cannot_tell", reason, quantity: null, matchedText: null, quantityMismatch: false });
const RETENTION_DAYS = 30;

/**
 * Stock checks. One visit to a page gives two results: the stock answer (by the owner's rules) and the link status (by the
 * mapping rules). The answer is in stock or out of stock only when the rules matched clearly. A login, puzzle, block, outage, changed
 * page or missing page is "cannot tell", never out of stock. Nothing here clicks, types or scrolls, changes the supplier's own status,
 * or puts a session, page text or picture in a log, an audit event or an observation.
 */
export function createStockChecker(deps: StockCheckDeps) {
  const { mappings, suppliers, supplierSessions, recipes, observations, captures, notifications, audit, browser, logger } = deps;
  const sleep = deps.sleep ?? wait;
  const now = deps.now ?? (() => new Date());

  /** The supplier and its active rules, or the plain reason a check must not run now. */
  async function gate(supplierId: string): Promise<{ supplier: SupplierRecord; active: Active } | { reason: SkipReason }> {
    const supplier = await suppliers.get(supplierId);
    if (!supplier) return { reason: "no_supplier" };
    const refused = whyNotChecked(supplier, (await supplierSessions.getSealed(supplierId)) !== null);
    if (refused) return { reason: refused.reason };
    const row = await recipes.active(supplierId);
    const checked = row ? validateRecipe(row.rules) : null;
    if (!row || !checked?.ok) return { reason: "no_recipe" };
    return { supplier, active: { recipe: checked.recipe, version: row.version } };
  }

  async function visit(supplier: SupplierRecord, mapping: MappingRow, recipe: Recipe): Promise<Visit> {
    const sealed = await supplierSessions.getSealed(supplier.id);
    let state;
    try {
      state = sealed ? unsealSessionState(sealed, deps.key) : null;
    } catch {
      state = null;
    }
    const outcome = state ? await browser.capture({ url: mapping.url, loginUrl: supplier.loginUrl ?? undefined, state, picture: true }) : null;
    if (!outcome || !outcome.ok) {
      if (outcome) logger.warn({ mappingId: mapping.id }, "stock check could not run: the browser service did not answer");
      const obs: Observation = { result: "service_unavailable", status: null, finalUrl: null, title: null, heading: null, softNotFound: false };
      const trial = decideLinkStatus(toState(mapping), obs, { requestedUrl: mapping.url, homeUrl: supplier.websiteUrl, now: now(), supplierWide: false });
      return { mapping, obs, page: null, picture: null, checkResult: state ? "service_unavailable" : "session_unreadable", decision: tell("check_failed"), linkTrial: trial.status };
    }
    const obs: Observation = { result: outcome.result, status: outcome.status, finalUrl: outcome.finalUrl, title: outcome.title, heading: outcome.heading, softNotFound: outcome.softNotFound };
    const trial = decideLinkStatus(toState(mapping), obs, { requestedUrl: mapping.url, homeUrl: supplier.websiteUrl, now: now(), supplierWide: false }).status;
    const page: PageDescription = {
      url: outcome.finalUrl ?? mapping.url,
      title: outcome.title ?? "",
      status: outcome.status,
      pageClass: outcome.result,
      sections: outcome.description.sections,
      buttons: outcome.description.buttons,
    };
    const region = (mapping.region ?? supplier.defaultRegion) || null;
    const decision = FAILED_VISIT.has(outcome.result)
      ? tell("check_failed")
      : trial === "page_missing"
        ? tell("page_missing")
        : trial === "never_worked"
          ? tell("never_worked")
          : decide(page, recipe, region);
    return { mapping, obs, page, picture: outcome.picture, checkResult: outcome.result, decision, linkTrial: trial };
  }

  /** Saves what a visit found: the link status, the kept capture when the page changed, and the observation. */
  async function finish(supplier: SupplierRecord, v: Visit, version: number, supplierWide: boolean): Promise<void> {
    const link = decideLinkStatus(toState(v.mapping), v.obs, { requestedUrl: v.mapping.url, homeUrl: supplier.websiteUrl, now: now(), supplierWide });
    await mappings.recordCheck(v.mapping.id, link);
    const captureId =
      v.decision.reason === "page_changed" && v.page
        ? await captures.keepChanged(v.mapping.id, { supplierId: supplier.id, pageClass: v.checkResult, description: v.page, picture: v.picture })
        : null;
    await observations.append({
      mappingId: v.mapping.id,
      answer: v.decision.answer,
      reason: v.decision.reason,
      quantity: v.decision.quantity,
      matchedText: v.decision.matchedText,
      quantityMismatch: v.decision.quantityMismatch,
      recipeVersion: version,
      checkResult: v.checkResult,
      captureId,
    });
    await audit.record({ action: "mapping.stock_checked", entityType: "mapping", entityId: v.mapping.id, details: { answer: v.decision.answer, reason: v.decision.reason } });
  }

  return {
    async checkStock(mappingId: string): Promise<StockOutcome> {
      const mapping = await mappings.get(mappingId);
      if (!mapping) return { kind: "skipped", reason: "no_mapping" };
      if (!mapping.enabled) return { kind: "skipped", reason: "link_off" };
      const gated = await gate(mapping.supplierId);
      if ("reason" in gated) return { kind: "skipped", reason: gated.reason };
      await captures.purge(RETENTION_DAYS);
      const v = await visit(gated.supplier, mapping, gated.active.recipe);
      await finish(gated.supplier, v, gated.active.version, false);
      return { kind: "checked", answer: v.decision.answer, reason: v.decision.reason };
    },

    /**
     * Every enabled link of one supplier, one page at a time, waiting the supplier's own pause between pages. The supplier is looked
     * at again before each page. Results are saved at the end, so a run where many pages changed or went missing at once is
     * recognised as a supplier-wide problem: one notification, and none of those links counted as missing.
     */
    async checkSupplierStock(supplierId: string): Promise<StockRunOutcome> {
      const first = await gate(supplierId);
      if ("reason" in first) return { kind: "skipped", reason: first.reason };
      await captures.purge(RETENTION_DAYS);
      const links = (await mappings.forSupplier(supplierId)).filter((m) => m.enabled);
      const visits: Visit[] = [];
      for (const [index, mapping] of links.entries()) {
        if (index > 0) await sleep(first.supplier.checkPauseSeconds * 1000);
        const gated = await gate(supplierId);
        if ("reason" in gated) break;
        visits.push(await visit(gated.supplier, mapping, first.active.recipe));
      }
      const wideLinks = isSupplierWide(visits.map((v) => v.linkTrial));
      const wideChange = isSupplierWideChange(visits.map((v) => v.decision.reason));
      for (const v of visits) await finish(first.supplier, v, first.active.version, wideLinks);
      if (visits.length > 0) {
        if (wideChange) {
          await notifications.raise({ kind: "recipe_needs_review", supplierId, reason: "page_changed", message: `${first.supplier.name}'s pages changed. Review its stock rules.` });
        } else {
          await notifications.resolve("recipe_needs_review", supplierId);
        }
      }
      return { kind: "done", checked: visits.length, supplierWide: wideChange };
    },
  };
}

export const checkStock = (deps: StockCheckDeps, mappingId: string) => createStockChecker(deps).checkStock(mappingId);
export const checkSupplierStock = (deps: StockCheckDeps, supplierId: string) => createStockChecker(deps).checkSupplierStock(supplierId);

/** The `extraction.check` and `extraction.checks` jobs. Their payloads are only an id. */
export function createStockCheckHandlers(deps: StockCheckDeps) {
  return {
    async one(payload: { mappingId: string }): Promise<void> {
      const outcome = await checkStock(deps, payload.mappingId);
      deps.logger.info({ mappingId: payload.mappingId, outcome: outcome.kind, ...(outcome.kind === "skipped" ? { reason: outcome.reason } : { answer: outcome.answer, reason: outcome.reason }) }, "stock check finished");
    },
    async many(payload: { supplierId: string }): Promise<void> {
      const outcome = await checkSupplierStock(deps, payload.supplierId);
      deps.logger.info({ supplierId: payload.supplierId, outcome: outcome.kind, ...(outcome.kind === "skipped" ? { reason: outcome.reason } : { checked: outcome.checked, supplierWide: outcome.supplierWide }) }, "supplier stock check finished");
    },
  };
}
