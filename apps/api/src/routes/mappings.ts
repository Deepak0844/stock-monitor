import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createImportPreviewRepository, createMappingRepository, createSupplierRepository, createSupplierSessionRepository, MappingRow } from "@stock-monitor/db";
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
const noteOf = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > MAX_NOTE) throw new AppError(400, "invalid_note", `A note can be up to ${MAX_NOTE} characters.`);
  return value.trim() || null;
};

/** Adds what a screen needs and the row does not store: whether the link is an "unavailable candidate". */
const present = (row: MappingRow) => ({
  ...row,
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

  app.get<{ Querystring: { supplierId?: string; status?: string; search?: string } }>("/api/mappings", async (request) => {
    const { supplierId, status, search } = request.query;
    return { mappings: (await mappings.list({ supplierId, linkStatus: status as never, search })).map(present) };
  });

  app.post("/api/mappings", async (request, reply) => {
    const input = object(request.body, ["variantId", "supplierId", "url", "note"]);
    if (typeof input.variantId !== "string" || typeof input.supplierId !== "string") throw BAD_INPUT();
    const supplier = await suppliers.get(input.supplierId);
    if (!supplier) throw new AppError(400, "supplier_not_found", "Choose a supplier that exists.");
    const note = noteOf(input.note);
    const url = await pageAddress(input.url, supplier.websiteUrl);
    if (await mappings.linkForVariant(input.variantId)) {
      throw new AppError(409, "already_mapped", "This variant already has a link. Edit or delete it instead.");
    }
    const result = await mappings.create({ variantId: input.variantId, supplierId: supplier.id, url, note });
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
    const input = object(request.body, ["url", "note", "enabled"]);
    if (Object.keys(input).length === 0) throw new AppError(400, "invalid_input", "There is nothing to change.");
    const current = await mappings.get(request.params.id);
    if (!current) throw MAPPING_NOT_FOUND();
    const patch: { url?: string; note?: string | null; enabled?: boolean } = {};
    if ("url" in input) {
      const supplier = await suppliers.get(current.supplierId);
      if (!supplier) throw SUPPLIER_NOT_FOUND();
      patch.url = await pageAddress(input.url, supplier.websiteUrl);
    }
    if ("note" in input) patch.note = noteOf(input.note);
    if ("enabled" in input) {
      if (typeof input.enabled !== "boolean") throw BAD_INPUT();
      patch.enabled = input.enabled;
    }
    if (!(await mappings.update(current.id, patch))) throw MAPPING_NOT_FOUND();
    await record(request, "mapping.updated", "mapping", current.id, { changed: Object.keys(patch) });
    return { mapping: present((await mappings.get(current.id)) as MappingRow) };
  });

  app.delete<{ Params: { id: string } }>("/api/mappings/:id", async (request) => {
    if (!(await mappings.remove(request.params.id))) throw MAPPING_NOT_FOUND();
    await record(request, "mapping.deleted", "mapping", request.params.id);
    return { ok: true };
  });

  app.get<{ Querystring: { mapped?: string; search?: string } }>("/api/variants", async (request) => {
    if (request.query.mapped !== "false") throw new AppError(400, "invalid_input", "Ask for the variants that are not mapped: mapped=false.");
    return mappings.unmappedVariants({ search: request.query.search });
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
      await queue.enqueue("mapping.links.check", { supplierId: supplier.id });
    } catch {
      throw NOT_STARTED();
    }
    await record(request, "mapping.supplier_check_requested", "supplier", supplier.id, { links });
    return reply.status(202).send({ queued: true, links });
  });
}
