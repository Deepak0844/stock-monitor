import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createImportPreviewRepository, createMappingRepository, createSupplierRepository } from "@stock-monitor/db";
import { buildPreview, parseCsv, readExport, suggestColumns, type Columns, type GoodRow } from "@stock-monitor/mapping";
import { AppError } from "../errors.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;
type Audit = ReturnType<typeof createAuditWriter>;
type Deps = {
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
  previews: ReturnType<typeof createImportPreviewRepository>;
};

// The CSV limit is 10 MB (checked by parseCsv, with a plain message). The body limit is a little above it so a file
// just over the limit gets that message and not a bare 413.
const BODY_LIMIT = 11 * 1024 * 1024;
const MAX_PROBLEMS = 500;
const MAX_WARNINGS = 100;
const SAMPLE = 20;

const readFile = (body: unknown) => {
  if (typeof body !== "string") throw new AppError(400, "invalid_file", "Upload the CSV file from Shopify's Products > Export.");
  const parsed = parseCsv(body);
  if (!parsed.ok) throw new AppError(400, "invalid_file", parsed.message);
  return parsed;
};

export function registerMappingImportRoutes(app: App, deps: Deps, audit: Audit): void {
  // The file is sent as the request body, as text/csv. No upload library is needed.
  app.addContentTypeParser("text/csv", { parseAs: "string", bodyLimit: BODY_LIMIT }, (_request, body, done) => done(null, body));

  app.post("/api/mappings/import/columns", async (request) => {
    const file = readFile(request.body);
    return { header: file.header, suggested: suggestColumns(file.header, file.rows.slice(0, 200)), rowCount: file.rows.length };
  });

  app.post<{ Querystring: Record<string, string | undefined> }>("/api/mappings/import/preview", async (request) => {
    const file = readFile(request.body);
    const column = (name: string): number => {
      const n = Number(request.query[name]);
      if (request.query[name] === undefined || !Number.isInteger(n) || n < 0 || n >= file.header.length) {
        throw new AppError(400, "invalid_columns", `Choose the ${name} column from the columns in the file.`);
      }
      return n;
    };
    const cols: Columns = { handle: column("handle"), sku: column("sku"), supplier: column("supplier"), address: column("address") };

    const [supplierList, skus, links, fromShopify] = await Promise.all([deps.suppliers.list(), deps.mappings.liveVariantSkus(), deps.mappings.linksByVariant(), deps.mappings.shopifyLinkSources()]);
    const suppliers = new Map(supplierList.map((s) => [s.name.toLowerCase(), { id: s.id, host: new URL(s.websiteUrl).hostname }]));
    const variantsBySku = new Map<string, string[]>();
    for (const v of skus) variantsBySku.set(v.sku.trim(), [...(variantsBySku.get(v.sku.trim()) ?? []), v.variantId]);
    const existing = new Map(links.map((l) => [l.variantId, { supplierId: l.supplierId, url: l.url }]));

    const preview = buildPreview(readExport(file.rows, cols), { suppliers, variantsBySku, shopifyManaged: new Set(fromShopify.map((v) => v.variantId)) }, existing);
    await deps.previews.purgeOlderThan(60);
    // Only the checked rows are kept: no descriptions, no other columns.
    const previewId = await deps.previews.save(preview.good.map(({ variantId, supplierId, url, line, sku }) => ({ variantId, supplierId, url, line, sku })));
    return {
      previewId,
      goodCount: preview.good.length,
      sample: preview.good.slice(0, SAMPLE),
      skippedSuppliers: preview.skippedSuppliers,
      skippedShopify: preview.skippedShopify,
      counts: preview.counts,
      problems: preview.problems.slice(0, MAX_PROBLEMS),
      problemCount: preview.problems.length,
      warnings: preview.warnings.slice(0, MAX_WARNINGS),
    };
  });

  app.post<{ Params: { previewId: string } }>("/api/mappings/import/:previewId/confirm", async (request) => {
    const stored = await deps.previews.take(request.params.previewId);
    if (!stored) throw new AppError(404, "preview_not_found", "That preview is no longer available. Upload the file again.");
    // A variant may have been linked to another supplier since the preview: leave those rows out.
    const taken = new Map((await deps.mappings.linksByVariant()).map((l) => [l.variantId, l.supplierId]));
    const rows = (stored as GoodRow[]).filter((r) => (taken.get(r.variantId) ?? r.supplierId) === r.supplierId);
    const result = await deps.mappings.upsertMany(rows.map(({ variantId, supplierId, url }) => ({ variantId, supplierId, url })));
    const skipped = stored.length - rows.length;
    await audit.record({ actorUserId: request.user?.id, action: "mapping.imported", entityType: "mapping", details: { ...result, skipped }, requestId: request.id });
    return { ...result, skipped };
  });
}
