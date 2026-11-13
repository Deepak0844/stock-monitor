import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createShopifyRepository, VariantRecord } from "@stock-monitor/db";
import type { Queue } from "@stock-monitor/queue";
import {
  assessScopes,
  checkConnection,
  createShopifyClient,
  createTokenProvider,
  isShopifyError,
  listLocations,
  validateShopDomain,
  type BaseUrlResolver,
  type Credentials,
  type ShopifyClient,
  type ShopifyClientOptions,
  type ShopifyErrorCode,
} from "@stock-monitor/shopify";
import { AppError } from "../errors.js";

type Repository = ReturnType<typeof createShopifyRepository>;
type Audit = ReturnType<typeof createAuditWriter>;

export type ShopifyRoutesDeps = {
  repo: Repository;
  queue: Pick<Queue, "enqueue">;
  /** Test only: points Shopify requests at a fake server. Comes from server config, never from a request. */
  baseUrl?: BaseUrlResolver;
  clientOptions?: Partial<Omit<ShopifyClientOptions, "shop" | "tokens" | "baseUrl">>;
};

const HTTP_STATUS: Record<ShopifyErrorCode, number> = {
  rejected_credentials: 422,
  no_access: 422,
  wrong_organization: 422,
  store_unavailable: 422,
  invalid_shop: 400,
  throttled: 503,
  unreachable: 503,
  unexpected_reply: 502,
};
const NEEDS_RECONNECT: ShopifyErrorCode[] = ["rejected_credentials", "wrong_organization"];

const NOT_CONNECTED = () => new AppError(409, "not_connected", "Connect Shopify first.");
const BAD_DETAILS = "Enter your store address, client ID and client secret.";

const credentialsBody = z.union([
  z.object({ shop: z.string().max(300), clientId: z.string().trim().min(1).max(256), clientSecret: z.string().trim().min(1).max(512) }).strict(),
  z.object({ shop: z.string().max(300), accessToken: z.string().trim().min(1).max(512) }).strict(),
]);
const locationBody = z.object({ id: z.string().regex(/^gid:\/\/shopify\/Location\/\d+$/) }).strict();
/** The SPU metafield is a list of URLs, which Shopify sends as JSON text. A plain address from an older sync is a list of one. */
function supplierUrls(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (Array.isArray(list)) return list.filter((u): u is string => typeof u === "string" && u.trim() !== "").map((u) => u.trim());
  } catch {
    // not JSON: a single address
  }
  return [raw];
}

const variantsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  warningsOnly: z.enum(["true", "false"]).optional(),
});

function parseDetails(body: unknown): { shop: string; credentials: Credentials } {
  const parsed = credentialsBody.safeParse(body);
  if (!parsed.success) throw new AppError(400, "invalid_input", BAD_DETAILS);
  const checked = validateShopDomain(parsed.data.shop);
  if (!checked.ok) throw new AppError(400, "invalid_shop", checked.message);
  const credentials: Credentials =
    "accessToken" in parsed.data
      ? { type: "static_token", accessToken: parsed.data.accessToken }
      : { type: "client_credentials", clientId: parsed.data.clientId, clientSecret: parsed.data.clientSecret };
  return { shop: checked.domain, credentials };
}

function warningsFor(v: VariantRecord) {
  const warnings: { code: string; message: string }[] = [];
  if (!v.tracked) {
    warnings.push({ code: "not_tracked", message: "Shopify is not tracking stock for this item, so quantity changes will have no effect." });
  }
  if (v.inventoryPolicy === "CONTINUE") {
    warnings.push({ code: "continue_selling", message: "This item keeps selling at 0." });
  }
  return warnings;
}

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export function registerShopifyRoutes(app: App, deps: ShopifyRoutesDeps, audit: Audit): void {
  const { repo } = deps;

  const makeClient = (shop: string, credentials: Credentials): ShopifyClient => {
    const tokens = createTokenProvider({ shop, credentials, baseUrl: deps.baseUrl });
    return createShopifyClient({ shop, tokens, baseUrl: deps.baseUrl, ...deps.clientOptions });
  };

  // The saved connection's client keeps its access token between requests. It is rebuilt whenever
  // the connection is saved or removed.
  let version = 0;
  let cached: { version: number; client: ShopifyClient } | null = null;
  async function savedClient(): Promise<ShopifyClient> {
    if (cached && cached.version === version) return cached.client;
    const saved = await repo.getCredentials();
    if (!saved) throw NOT_CONNECTED();
    cached = { version, client: makeClient(saved.shop, saved.credentials) };
    return cached.client;
  }

  /** Runs Shopify work and turns Shopify problems into plain API errors. */
  async function guard<T>(work: () => Promise<T>, opts: { markReconnect: boolean }): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!isShopifyError(error)) throw error;
      if (opts.markReconnect && NEEDS_RECONNECT.includes(error.code)) await repo.setStatus("needs_reconnect");
      throw new AppError(HTTP_STATUS[error.code], `shopify_${error.code}`, error.message);
    }
  }

  const summary = (shopName: string, scopes: string[] | null) => {
    const { ok: _ok, ...assessment } = assessScopes(scopes);
    return { shopName, scopes, ...assessment };
  };

  app.post("/api/shopify/test", async (request) => {
    const hasDetails = request.body !== undefined && request.body !== null;
    const details = hasDetails ? parseDetails(request.body) : null;
    const client = details ? makeClient(details.shop, details.credentials) : await savedClient();
    const checked = await guard(() => checkConnection(client), { markReconnect: !details });
    const result = summary(checked.shopName, checked.scopes);
    await audit.record({
      actorUserId: request.user?.id,
      action: "shopify.connection_tested",
      entityType: "shopify_connection",
      details: { shop: details?.shop ?? "saved connection", warnings: result.warnings.length },
      requestId: request.id,
    });
    return result;
  });

  app.post("/api/shopify/connection", async (request) => {
    const { shop, credentials } = parseDetails(request.body);
    const checked = await guard(() => checkConnection(makeClient(shop, credentials)), { markReconnect: false });

    const existing = await repo.getConnection();
    const keep = existing?.shop === shop && existing.locationId && existing.locationName
      ? { id: existing.locationId, name: existing.locationName }
      : null;
    await repo.saveConnection({ shop, credentials, scopes: checked.scopes ?? [], location: keep });
    version += 1;

    await audit.record({
      actorUserId: request.user?.id,
      action: "shopify.connected",
      entityType: "shopify_connection",
      details: { shop, credentialType: credentials.type, scopes: checked.scopes },
      requestId: request.id,
    });
    return { connection: await repo.getConnection(), ...summary(checked.shopName, checked.scopes) };
  });

  app.get("/api/shopify/connection", async () => ({ connection: await repo.getConnection() }));

  app.delete("/api/shopify/connection", async (request) => {
    await repo.deleteConnection();
    version += 1;
    await audit.record({
      actorUserId: request.user?.id,
      action: "shopify.disconnected",
      entityType: "shopify_connection",
      requestId: request.id,
    });
    return { ok: true };
  });

  app.get("/api/shopify/locations", async () => {
    const client = await savedClient();
    const locations = await guard(() => listLocations(client), { markReconnect: true });
    return { locations: locations.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name })) };
  });

  app.put("/api/shopify/location", async (request) => {
    const parsed = locationBody.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, "invalid_input", "Choose a location from the list.");
    const client = await savedClient();
    const locations = await guard(() => listLocations(client), { markReconnect: true });
    const chosen = locations.find((l) => l.isActive && l.id === parsed.data.id);
    if (!chosen) {
      throw new AppError(400, "invalid_location", "That location is not available in Shopify. Choose one from the list.");
    }
    await repo.setLocation({ id: chosen.id, name: chosen.name });
    await audit.record({
      actorUserId: request.user?.id,
      action: "shopify.location_chosen",
      entityType: "shopify_connection",
      details: { locationId: chosen.id, locationName: chosen.name },
      requestId: request.id,
    });
    return { location: { id: chosen.id, name: chosen.name } };
  });

  app.post("/api/shopify/sync", async (request, reply) => {
    const connection = await repo.getConnection();
    if (!connection) throw NOT_CONNECTED();
    if (connection.status === "needs_reconnect") {
      throw new AppError(409, "needs_reconnect", "Shopify rejected the saved connection. Reconnect Shopify.");
    }
    if (!connection.locationId) throw new AppError(409, "no_location", "Choose an inventory location first.");
    if (await repo.isSyncRunning()) throw new AppError(409, "sync_running", "A sync is already running.");

    // The job carries no data. The worker reads everything it needs from the database.
    await deps.queue.enqueue("shopify.sync", {});
    await audit.record({
      actorUserId: request.user?.id,
      action: "shopify.sync_requested",
      entityType: "shopify_connection",
      requestId: request.id,
    });
    return reply.status(202).send({ queued: true });
  });

  app.get("/api/shopify/sync", async () => ({ lastRun: await repo.lastSyncRun() }));

  app.get("/api/shopify/variants", async (request) => {
    const parsed = variantsQuery.safeParse(request.query);
    if (!parsed.success) throw new AppError(400, "invalid_input", "Check the search and page values and try again.");
    const { search, page, pageSize, warningsOnly } = parsed.data;
    const result = await repo.listVariants({ search: search || undefined, page, pageSize, warningsOnly: warningsOnly === "true" });
    return {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      items: result.items.map((v) => ({
        variantId: v.variantId,
        productTitle: v.productTitle,
        variantTitle: v.variantTitle,
        options: v.options,
        sku: v.sku,
        tracked: v.tracked,
        inventoryPolicy: v.inventoryPolicy,
        available: v.available,
        supplierName: v.supplierName,
        supplierUrls: supplierUrls(v.supplierUrl),
        syncedAt: v.syncedAt,
        warnings: warningsFor(v),
      })),
    };
  });
}
