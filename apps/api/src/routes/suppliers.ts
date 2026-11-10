import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createSupplierRepository, SupplierInput, SupplierPatch } from "@stock-monitor/db";
import { validateSupplierUrl, verifyPublicHost, type HostLookup } from "@stock-monitor/supplier-session";
import { AppError } from "../errors.js";

type Repository = ReturnType<typeof createSupplierRepository>;
type Audit = ReturnType<typeof createAuditWriter>;
type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export type SupplierRoutesDeps = {
  repo: Repository;
  /** Test only: replaces the real DNS lookup. */
  lookup?: HostLookup;
  /** Runs before a supplier is deleted, for example to close a login window that is open for it. */
  beforeDelete?: (supplierId: string) => Promise<void>;
};

const DEFAULT_INTERVAL = 60;
const MIN_INTERVAL = 15;
const MAX_INTERVAL = 1440;
const MAX_NAME = 100;
const FIELDS = ["name", "websiteUrl", "loginUrl", "checkIntervalMinutes"];

const NOT_FOUND = () => new AppError(404, "supplier_not_found", "That supplier does not exist.");
const NAME_TAKEN = () => new AppError(409, "name_taken", "You already have a supplier with that name.");

/** Checks every field and returns the cleaned values. The hosts are looked up afterwards. */
function readFields(body: unknown, partial: boolean): { values: SupplierPatch; hosts: { host: string; code: string }[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError(400, "invalid_input", "Check the supplier details and try again.");
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !FIELDS.includes(key))) {
    throw new AppError(400, "invalid_input", "Check the supplier details and try again.");
  }
  if (partial && Object.keys(input).length === 0) throw new AppError(400, "invalid_input", "There is nothing to change.");

  const values: SupplierPatch = {};
  const hosts: { host: string; code: string }[] = [];

  if (!partial || "name" in input) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > MAX_NAME) {
      throw new AppError(400, "invalid_name", `Enter a name for the supplier, up to ${MAX_NAME} characters.`);
    }
    values.name = name;
  }

  const address = (field: "websiteUrl" | "loginUrl", code: string, value: unknown) => {
    const checked = validateSupplierUrl(value);
    if (!checked.ok) throw new AppError(400, code, checked.message);
    hosts.push({ host: checked.host, code });
    return checked.url;
  };
  if (!partial || "websiteUrl" in input) values.websiteUrl = address("websiteUrl", "invalid_website", input.websiteUrl);
  if ("loginUrl" in input) {
    const blank = input.loginUrl === null || (typeof input.loginUrl === "string" && input.loginUrl.trim() === "");
    values.loginUrl = blank ? null : address("loginUrl", "invalid_login_url", input.loginUrl);
  } else if (!partial) {
    values.loginUrl = null;
  }

  if ("checkIntervalMinutes" in input || !partial) {
    const minutes = "checkIntervalMinutes" in input ? input.checkIntervalMinutes : DEFAULT_INTERVAL;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < MIN_INTERVAL || minutes > MAX_INTERVAL) {
      throw new AppError(400, "invalid_interval", `Check interval must be a whole number of minutes from ${MIN_INTERVAL} to ${MAX_INTERVAL}.`);
    }
    values.checkIntervalMinutes = minutes;
  }
  return { values, hosts };
}

export function registerSupplierRoutes(app: App, deps: SupplierRoutesDeps, audit: Audit): void {
  const { repo } = deps;

  async function checked(body: unknown, partial: boolean): Promise<SupplierPatch> {
    const { values, hosts } = readFields(body, partial);
    for (const { host, code } of hosts) {
      const result = await verifyPublicHost(host, deps.lookup);
      if (!result.ok) throw new AppError(400, code, result.message);
    }
    return values;
  }

  const record = (request: { user: { id: string } | null; id: string }, action: string, id: string, details?: Record<string, unknown>) =>
    audit.record({ actorUserId: request.user?.id, action, entityType: "supplier", entityId: id, details, requestId: request.id });

  app.get("/api/suppliers", async () => ({ suppliers: await repo.list() }));

  app.post("/api/suppliers", async (request, reply) => {
    const values = (await checked(request.body, false)) as SupplierInput;
    const result = await repo.create(values);
    if (!result.ok) throw NAME_TAKEN();
    await record(request, "supplier.created", result.supplier.id, { name: result.supplier.name });
    return reply.status(201).send({ supplier: result.supplier });
  });

  app.get<{ Params: { id: string } }>("/api/suppliers/:id", async (request) => {
    const supplier = await repo.get(request.params.id);
    if (!supplier) throw NOT_FOUND();
    return { supplier };
  });

  app.patch<{ Params: { id: string } }>("/api/suppliers/:id", async (request) => {
    const values = await checked(request.body, true);
    const result = await repo.update(request.params.id, values);
    if (!result.ok) throw result.reason === "name_taken" ? NAME_TAKEN() : NOT_FOUND();
    await record(request, "supplier.updated", result.supplier.id, { changed: Object.keys(values) });
    return { supplier: result.supplier };
  });

  app.delete<{ Params: { id: string } }>("/api/suppliers/:id", async (request) => {
    const supplier = await repo.get(request.params.id);
    if (!supplier) throw NOT_FOUND();
    await deps.beforeDelete?.(supplier.id);
    if (!(await repo.remove(supplier.id))) throw NOT_FOUND();
    await record(request, "supplier.deleted", supplier.id, { name: supplier.name });
    return { ok: true };
  });

  for (const [path, action, change] of [
    ["pause", "supplier.paused", repo.pause],
    ["resume", "supplier.resumed", repo.resume],
  ] as const) {
    app.post<{ Params: { id: string } }>(`/api/suppliers/:id/${path}`, async (request) => {
      const supplier = await change(request.params.id);
      if (!supplier) throw NOT_FOUND();
      await record(request, action, supplier.id, { name: supplier.name });
      return { supplier };
    });
  }
}
