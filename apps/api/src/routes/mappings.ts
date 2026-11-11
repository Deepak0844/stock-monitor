import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createImportPreviewRepository, createMappingRepository, createObservationRepository, createProposalRepository, ObservationRecord, createSupplierRepository, createSupplierSessionRepository, MappingRow } from "@stock-monitor/db";
import type { Queue } from "@stock-monitor/queue";
import { isUnavailableCandidate, sameSite, whyNotChecked } from "@stock-monitor/mapping";
import { validateSupplierUrl, verifyPublicHost, type HostLookup } from "@stock-monitor/supplier-session";
import { AppError } from "../errors.js";
import { registerMappingImportRoutes } from "./mapping-import.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;
type Audit = ReturnType<typeof createAuditWriter>;

export type MappingRoutesDeps = {
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
  /** Import from the Shopify export. Left out, there are no /api/mappings/import routes. */
  previews?: ReturnType<typeof createImportPreviewRepository>;
  /** The latest stock answer on each link. Left out, links carry no stock answer. */
  observations?: ReturnType<typeof createObservationRepository>;
  /** When set, each link carries its latest suggestion. */
  proposals?: ReturnType<typeof createProposalRepository>;
  /** Link checks. Both are needed. Left out, there are no check routes. */
  supplierSessions?: ReturnType<typeof createSupplierSessionRepository>;
  queue?: Pick<Queue, "enqueue">;
  /** Test only: replaces the real DNS lookup. */
  lookup?: HostLookup;
};

const MAX_NOTE = 500;
const PERMISSIONS = ["unknown", "granted", "not_granted"] as const;
const BAD_INPUT = () => new AppError(400, "invalid_input", "Check the details and try again.");
const MAPPING_NOT_FOUND = () => new AppError(404, "mapping_not_found", "That link does not exist.");
const SUPPLIER_NOT_FOUND = () => new AppError(404, "supplier_not_found", "That supplier does not exist.");

const object = (body: unknown, allowed: string[]): Record<string, unknown> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw BAD_INPUT();
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw BAD_INPUT();
  return input;
};
const MAX_REGION = 200;
/** A link's own region: text up to 200 characters, or empty/null for none (the supplier's default region is used then). */
const regionOf = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > MAX_REGION) throw new AppError(400, "invalid_region", `A region can be up to ${MAX_REGION} characters of text, or empty to clear it.`);
  return value.trim() || null;
};
const noteOf = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > MAX_NOTE) throw new AppError(400, "invalid_note", `A note can be up to ${MAX_NOTE} characters.`);
  return value.trim() || null;
};

/** Adds what a screen needs and the row does not store: whether the link is an "unavailable candidate". */
const present = (row: MappingRow, latest?: ObservationRecord, suggestion?: { id: string; state: string; kind: string }) => ({
  ...row,
  latestSuggestion: suggestion ?? null,
  latestStock: latest ? { answer: latest.answer, reason: latest.reason, quantity: latest.quantity, matchedText: latest.matchedText, observedAt: latest.observedAt } : null,
  unavailableCandidate: isUnavailableCandidate(
    { status: row.linkStatus, lastWorkedAt: row.lastWorkedAt, workedTitle: row.workedTitle, workedHeading: row.workedHeading, missingChecks: row.missingChecks, firstMissingAt: row.firstMissingAt, checkedAt: row.lastLinkCheckAt },
    false,
  ),
});

export function registerMappingRoutes(app: App, deps: MappingRoutesDeps, audit: Audit): void {
  const { mappings, suppliers } = deps;
  if (deps.previews) registerMappingImportRoutes(app, { mappings, suppliers, previews: deps.previews }, audit);

  const record = (request: { user: { id: string } | null; id: string }, action: string, entityType: string, id: string, details?: Record<string, unknown>) =>
    audit.record({ actorUserId: request.user?.id, action, entityType, entityId: id, details, requestId: request.id });

  /** An address the browser will visit: a public https page on the supplier's own website. */
  async function pageAddress(value: unknown, supplierWebsite: string): Promise<string> {
    const checked = validateSupplierUrl(value);
    if (!checked.ok) throw new AppError(400, "invalid_url", checked.message);
    const host = new URL(supplierWebsite).hostname;
    if (!sameSite(checked.url, host)) throw new AppError(400, "wrong_site", "That address is not on this supplier's website.");
    const lookedUp = await verifyPublicHost(checked.host, deps.lookup);
    if (!lookedUp.ok) throw new AppError(400, "invalid_url", lookedUp.message);
    return checked.url;
  }

  const pageQuery = z.object({
    page: z.coerce.number().int().min(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  });

  const filterQuery = z.object({
    supplierId: z.string().uuid().optional(),
    status: z.enum(["not_checked", "works", "never_worked", "page_missing", "moved", "looks_different", "needs_login", "could_not_check"]).optional(),
    search: z.string().trim().max(100).optional(),
  });

  // With no `page` this lists every link, which the dashboard and a supplier's rules page rely on.
  app.get("/api/mappings", async (request) => {
    const query = request.query as { page?: string; pageSize?: string };
    const filters = filterQuery.safeParse(request.query);
    if (!filters.success) throw new AppError(400, "invalid_input", "Check the search and status and try again.");
    const { supplierId, status, search } = filters.data;
    const filter = { supplierId, linkStatus: status, search: search || undefined };
    const latest = deps.observations ? await deps.observations.latestByMapping() : new Map<string, ObservationRecord>();
    const suggestions = deps.proposals ? await deps.proposals.latestByMapping() : new Map();
    if (query.page === undefined) {
      const rows = await mappings.list(filter);
      return { mappings: rows.map((row) => present(row, latest.get(row.id), suggestions.get(row.id))) };
    }
    const paging = pageQuery.safeParse(request.query);
    if (!paging.success) throw new AppError(400, "invalid_input", "Check the page values and try again.");
    const { rows, total } = await mappings.page({ ...filter, ...paging.data });
    return { mappings: rows.map((row) => present(row, latest.get(row.id), suggestions.get(row.id))), total, page: paging.data.page, pageSize: paging.data.pageSize };
  });

  app.post("/api/mappings", async (request, reply) => {
    const input = object(request.body, ["variantId", "supplierId", "url", "note", "region"]);
    if (typeof input.variantId !== "string" || typeof input.supplierId !== "string") throw BAD_INPUT();
    const supplier = await suppliers.get(input.supplierId);
    if (!supplier) throw new AppError(400, "supplier_not_found", "Choose a supplier that exists.");
    const note = noteOf(input.note);
    const region = regionOf(input.region);
    const url = await pageAddress(input.url, supplier.websiteUrl);
    if (await mappings.linkForVariant(input.variantId)) {
      throw new AppError(409, "already_mapped", "This variant already has a link. Edit or delete it instead.");
    }
    const result = await mappings.create({ variantId: input.variantId, supplierId: supplier.id, url, note, region });
    if (!result.ok) {
      if (result.reason === "unknown_variant") throw new AppError(400, "variant_not_found", "Choose a product variant that exists.");
      throw new AppError(409, "already_mapped", "This variant already has a link. Edit or delete it instead.");
    }
    await record(request, "mapping.created", "mapping", result.mapping.id, { variantId: input.variantId, supplierId: supplier.id });
    return reply.status(201).send({ mapping: result.mapping });
  });

  app.get<{ Params: { id: string } }>("/api/mappings/:id", async (request) => {
    const mapping = await mappings.get(request.params.id);
    if (!mapping) throw MAPPING_NOT_FOUND();
    return { mapping: present(mapping) };
  });

  app.patch<{ Params: { id: string } }>("/api/mappings/:id", async (request) => {
    const input = object(request.body, ["url", "note", "region", "enabled"]);
    if (Object.keys(input).length === 0) throw new AppError(400, "invalid_input", "There is nothing to change.");
    const current = await mappings.get(request.params.id);
    if (!current) throw MAPPING_NOT_FOUND();
    const patch: { url?: string; note?: string | null; region?: string | null; enabled?: boolean } = {};
    if ("url" in input) {
      const supplier = await suppliers.get(current.supplierId);
      if (!supplier) throw SUPPLIER_NOT_FOUND();
      patch.url = await pageAddress(input.url, supplier.websiteUrl);
    }
    if ("note" in input) patch.note = noteOf(input.note);
    if ("region" in input) patch.region = regionOf(input.region);
    if ("enabled" in input) {
      if (typeof input.enabled !== "boolean") throw BAD_INPUT();
      patch.enabled = input.enabled;
    }
    if (!(await mappings.update(current.id, patch))) throw MAPPING_NOT_FOUND();
    await record(request, "mapping.updated", "mapping", current.id, { changed: Object.keys(patch) });
    // Turning a link off or on changes whether its suggestion still applies, so ask for it to be looked at again.
    if ("enabled" in patch) await deps.queue?.enqueue("proposals.evaluate", { mappingId: current.id }).catch((error) => request.log.warn({ err: error }, "could not queue a suggestions evaluation"));
    return { mapping: present((await mappings.get(current.id)) as MappingRow) };
  });

  app.delete<{ Params: { id: string } }>("/api/mappings/:id", async (request) => {
    if (!(await mappings.remove(request.params.id))) throw MAPPING_NOT_FOUND();
    await record(request, "mapping.deleted", "mapping", request.params.id);
    return { ok: true };
  });

  app.get<{ Querystring: { mapped?: string } }>("/api/variants", async (request) => {
    if (request.query.mapped !== "false") throw new AppError(400, "invalid_input", "Ask for the variants that are not mapped: mapped=false.");
    const search = z.string().trim().max(100).optional().safeParse((request.query as { search?: unknown }).search);
    if (!search.success) throw new AppError(400, "invalid_input", "Check the search and try again.");
    return mappings.unmappedVariants({ search: search.data || undefined });
  });

  app.patch<{ Params: { id: string } }>("/api/suppliers/:id/permission", async (request) => {
    const input = object(request.body, ["status", "note", "pauseSeconds"]);
    if (!PERMISSIONS.includes(input.status as never)) throw new AppError(400, "invalid_status", "Choose unknown, granted or not granted.");
    const pause = input.pauseSeconds;
    if (pause !== undefined && (typeof pause !== "number" || !Number.isInteger(pause) || pause < 1 || pause > 3600)) {
      throw new AppError(400, "invalid_pause", "The pause between pages must be a whole number of seconds from 1 to 3600.");
    }
    const supplier = await suppliers.setPermission(request.params.id, {
      status: input.status as (typeof PERMISSIONS)[number],
      note: noteOf(input.note),
      pauseSeconds: pause as number | undefined,
    });
    if (!supplier) throw SUPPLIER_NOT_FOUND();
    await record(request, "supplier.permission_set", "supplier", supplier.id, { status: supplier.automationPermission, pauseSeconds: supplier.checkPauseSeconds });
    return { supplier };
  });

  const { supplierSessions, queue } = deps;
  if (!supplierSessions || !queue) return;

  /** A supplier whose links may be checked now, or the plain reason they may not. */
  async function readySupplier(supplierId: string) {
    const supplier = await suppliers.get(supplierId);
    if (!supplier) throw SUPPLIER_NOT_FOUND();
    const refused = whyNotChecked(supplier, (await supplierSessions!.getSealed(supplierId)) !== null);
    if (refused) throw new AppError(409, refused.reason, refused.message);
    return supplier;
  }
  // A run waits the supplier's pause between pages, so it can take far longer than the queue's default 15 minutes. If the
  // queue gave up on it half way it would start the whole run again at the same time as the first.
  const RUN_MIN_SECONDS = 15 * 60;
  const RUN_MAX_SECONDS = 6 * 60 * 60;
  const PER_PAGE_EXTRA_SECONDS = 30;
  const NOT_STARTED = () => new AppError(503, "check_not_started", "The check could not be started. Please try again in a minute.");

  app.post<{ Params: { id: string } }>("/api/mappings/:id/check-link", async (request, reply) => {
    const mapping = await mappings.get(request.params.id);
    if (!mapping) throw MAPPING_NOT_FOUND();
    if (!mapping.enabled) throw new AppError(409, "link_off", "This link is switched off. Switch it on to check it.");
    await readySupplier(mapping.supplierId);
    try {
      await queue.enqueue("mapping.link.check", { mappingId: mapping.id });
    } catch {
      throw NOT_STARTED();
    }
    await record(request, "mapping.check_requested", "mapping", mapping.id);
    return reply.status(202).send({ queued: true });
  });

  app.post<{ Params: { id: string } }>("/api/suppliers/:id/check-links", async (request, reply) => {
    const supplier = await readySupplier(request.params.id);
    const links = (await mappings.forSupplier(supplier.id)).filter((m) => m.enabled).length;
    if (links === 0) throw new AppError(409, "no_links", "This supplier has no links to check yet.");
    try {
      const seconds = links * (supplier.checkPauseSeconds + PER_PAGE_EXTRA_SECONDS);
      await queue.enqueue(
        "mapping.links.check",
        { supplierId: supplier.id },
        { expireInSeconds: Math.min(RUN_MAX_SECONDS, Math.max(RUN_MIN_SECONDS, seconds)), retryLimit: 0 },
      );
    } catch {
      throw NOT_STARTED();
    }
    await record(request, "mapping.supplier_check_requested", "supplier", supplier.id, { links });
    return reply.status(202).send({ queued: true, links });
  });
}
