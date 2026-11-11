import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createCaptureRepository, createMappingRepository, createSupplierRepository, createSupplierSessionRepository, ExpectedAnswer } from "@stock-monitor/db";
import { whyNotChecked } from "@stock-monitor/mapping";
import type { Queue } from "@stock-monitor/queue";
import { AppError } from "../errors.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;
type Audit = ReturnType<typeof createAuditWriter>;

export type CaptureRoutesDeps = {
  captures: ReturnType<typeof createCaptureRepository>;
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  queue: Pick<Queue, "enqueue">;
};

const MAX_NAME = 200;
const EXPECTED: ExpectedAnswer[] = ["in_stock", "out_of_stock", "cannot_tell"];
const BAD_INPUT = () => new AppError(400, "invalid_input", "Check the details and try again.");
const CAPTURE_NOT_FOUND = () => new AppError(404, "capture_not_found", "That capture does not exist.");

const only = (body: unknown, allowed: string[]): Record<string, unknown> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw BAD_INPUT();
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw BAD_INPUT();
  return input;
};
const nameOf = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > MAX_NAME) throw new AppError(400, "invalid_name", `A name can be up to ${MAX_NAME} characters.`);
  return value.trim();
};

/**
 * Saved pages. A capture is private page content: it is shown only to the signed-in owner, its picture is never cached, and
 * none of it is ever written to the audit log or a job (the job carries only the capture's id).
 */
export function registerCaptureRoutes(app: App, deps: CaptureRoutesDeps, audit: Audit): void {
  const { captures, mappings, suppliers, supplierSessions, queue } = deps;
  const record = (request: { user: { id: string } | null; id: string }, action: string, id: string, details?: Record<string, unknown>) =>
    audit.record({ actorUserId: request.user?.id, action, entityType: "capture", entityId: id, details, requestId: request.id });

  app.post<{ Params: { id: string } }>("/api/suppliers/:id/captures", async (request, reply) => {
    const input = only(request.body, ["mappingId", "name"]);
    if (typeof input.mappingId !== "string") throw BAD_INPUT();
    const name = nameOf(input.name);
    const supplier = await suppliers.get(request.params.id);
    if (!supplier) throw new AppError(404, "supplier_not_found", "That supplier does not exist.");
    const mapping = await mappings.get(input.mappingId);
    if (!mapping || mapping.supplierId !== supplier.id) throw new AppError(400, "link_not_found", "Choose one of this supplier's links.");
    const refused = whyNotChecked(supplier, (await supplierSessions.getSealed(supplier.id)) !== null);
    if (refused) throw new AppError(409, refused.reason, refused.message);

    // Old unlabelled captures go whenever a new one is asked for. shortcut: no timer, so an idle app keeps them until the next request.
    await captures.purge(30);
    const capture = await captures.create({ supplierId: supplier.id, mappingId: mapping.id, name });
    try {
      await queue.enqueue("extraction.capture", { captureId: capture.id });
    } catch {
      await captures.remove(capture.id);
      throw new AppError(503, "capture_not_started", "The capture could not be started. Please try again in a minute.");
    }
    await record(request, "capture.requested", capture.id, { supplierId: supplier.id });
    return reply.status(202).send({ capture });
  });

  app.get<{ Params: { id: string } }>("/api/suppliers/:id/captures", async (request) => ({ captures: await captures.list(request.params.id) }));

  app.get<{ Params: { id: string } }>("/api/captures/:id", async (request) => {
    const capture = await captures.get(request.params.id);
    if (!capture) throw CAPTURE_NOT_FOUND();
    return { capture };
  });

  app.get<{ Params: { id: string } }>("/api/captures/:id/picture", async (request, reply) => {
    const picture = await captures.picture(request.params.id);
    if (!picture) {
      if (!(await captures.get(request.params.id))) throw CAPTURE_NOT_FOUND();
      throw new AppError(404, "picture_not_found", "This capture has no picture.");
    }
    // Private page content: never kept by a browser or a proxy.
    const type = picture[0] === 0xff && picture[1] === 0xd8 ? "image/jpeg" : "image/png"; // a long page is kept as a JPEG
    return reply.header("content-type", type).header("cache-control", "private, no-store").send(picture);
  });

  app.patch<{ Params: { id: string } }>("/api/captures/:id", async (request) => {
    const input = only(request.body, ["name", "expected"]);
    if (Object.keys(input).length === 0) throw new AppError(400, "invalid_input", "There is nothing to change.");
    const patch: { name?: string; expected?: ExpectedAnswer | null } = {};
    if ("name" in input) patch.name = nameOf(input.name);
    if ("expected" in input) {
      if (input.expected !== null && !EXPECTED.includes(input.expected as ExpectedAnswer)) {
        throw new AppError(400, "invalid_expected", "Choose in stock, out of stock or cannot tell.");
      }
      patch.expected = input.expected as ExpectedAnswer | null;
    }
    const capture = await captures.label(request.params.id, patch);
    if (!capture) throw CAPTURE_NOT_FOUND();
    await record(request, "capture.labelled", capture.id, { changed: Object.keys(patch), expected: capture.expectedAnswer });
    return { capture };
  });

  app.delete<{ Params: { id: string } }>("/api/captures/:id", async (request) => {
    if (!(await captures.remove(request.params.id))) throw CAPTURE_NOT_FOUND();
    await record(request, "capture.deleted", request.params.id);
    return { ok: true };
  });
}
