import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient } from "@stock-monitor/browser-client";
import type { createSupplierCredentialsRepository, createSupplierRepository, SupplierInput, SupplierPatch } from "@stock-monitor/db";
import type { Queue } from "@stock-monitor/queue";
import { isCredentials, isLoginSelectors, sealCredentials, validateSupplierUrl, verifyPublicHost, type HostLookup } from "@stock-monitor/supplier-session";
import { createLoginLimiter } from "../rate-limit.js";
import { AppError } from "../errors.js";

type Repository = ReturnType<typeof createSupplierRepository>;
type Audit = ReturnType<typeof createAuditWriter>;
type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export type SupplierRoutesDeps = {
  repo: Repository;
  /** Saved logins. With `key` and `queue`, turns on the automatic login routes. */
  credentials?: ReturnType<typeof createSupplierCredentialsRepository>;
  /** The key and key id that seal sessions, used the same way for logins. */
  key?: { key: Buffer; keyId: string };
  queue?: Pick<Queue, "enqueue">;
  /** The browser service, for "Check login page". Without it that route does not exist. */
  browser?: Pick<BrowserClient, "inspectLogin">;
  /** Test only: replaces the real DNS lookup. */
  lookup?: HostLookup;
  /** Runs before a supplier is deleted, for example to close a login window that is open for it. */
  beforeDelete?: (supplierId: string) => Promise<void>;
};

const DEFAULT_INTERVAL = 60;
const MIN_INTERVAL = 15;
const MAX_INTERVAL = 1440;
const MAX_NAME = 100;
const FIELDS = ["name", "websiteUrl", "loginUrl", "checkIntervalMinutes", "shopifyName"];
const MAX_SHOPIFY_NAME = 200;

const NOT_FOUND = () => new AppError(404, "supplier_not_found", "That supplier does not exist.");
const NAME_TAKEN = () => new AppError(409, "name_taken", "You already have a supplier with that name.");
const SHOPIFY_NAME_TAKEN = () => new AppError(409, "shopify_name_taken", "Another supplier already uses that name for Shopify matching.");
const taken = (reason: "name_taken" | "shopify_name_taken" | "not_found") => (reason === "name_taken" ? NAME_TAKEN() : reason === "shopify_name_taken" ? SHOPIFY_NAME_TAKEN() : NOT_FOUND());

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

  if ("shopifyName" in input) {
    const value = input.shopifyName;
    if (value !== null && (typeof value !== "string" || value.trim().length > MAX_SHOPIFY_NAME)) {
      throw new AppError(400, "invalid_shopify_name", `The name in Shopify can be up to ${MAX_SHOPIFY_NAME} characters, or empty to use the supplier's name.`);
    }
    values.shopifyName = value === null ? null : value.trim() || null;
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

const AUTO_LOGIN_BODY = ["autoLogin", "stealth", "freshProfile", "loginSelectors", "loggedInMarker", "codeEmailFrom"];
/** A code email sender: a domain (mail.example.com) or one address (codes@example.com). */
const SENDER = /^(?:[^@\s]+@)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const NO_CREDENTIALS = () => new AppError(409, "no_credentials", "Save a username and password first.");
const NOT_GRANTED = () => new AppError(409, "not_granted", "Mark this supplier as allowing automatic checks first.");

export function registerSupplierRoutes(app: App, deps: SupplierRoutesDeps, audit: Audit): void {
  const { repo, credentials } = deps;
  // The date only, never the values. Without the credentials store there is nothing saved.
  const decorate = async <T extends { id: string }>(supplier: T) => ({
    ...supplier,
    credentialsSavedAt: (await credentials?.savedAt(supplier.id)) ?? null,
  });

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

  const pageQuery = z.object({
    page: z.coerce.number().int().min(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(100).optional(),
    status: z.enum(["connected", "needs_reconnect", "blocked", "paused", "not_connected", "no_login"]).optional(),
  });

  // With no `page` this lists every supplier, which the dropdowns and the dashboard rely on.
  app.get("/api/suppliers", async (request) => {
    if ((request.query as { page?: unknown }).page === undefined) return { suppliers: await Promise.all((await repo.list()).map(decorate)) };
    const parsed = pageQuery.safeParse(request.query);
    if (!parsed.success) throw new AppError(400, "invalid_input", "Check the search, status and page values and try again.");
    const { items, total } = await repo.page({ ...parsed.data, search: parsed.data.search || undefined });
    return { items: await Promise.all(items.map(decorate)), total, page: parsed.data.page, pageSize: parsed.data.pageSize };
  });

  app.post("/api/suppliers", async (request, reply) => {
    // Whether its pages need a login can be chosen when adding. It is applied after the create, by the same rule as a later change.
    const body = request.body;
    let needsLogin: boolean | undefined;
    let rest: unknown = body;
    if (typeof body === "object" && body !== null && !Array.isArray(body) && "needsLogin" in body) {
      const { needsLogin: given, ...others } = body as Record<string, unknown>;
      if (typeof given !== "boolean") throw new AppError(400, "invalid_input", "Check the supplier details and try again.");
      needsLogin = given;
      rest = others;
    }
    const values = (await checked(rest, false)) as SupplierInput;
    const result = await repo.create(values);
    if (!result.ok) throw taken(result.reason);
    const supplier = needsLogin === false ? ((await repo.setNeedsLogin(result.supplier.id, false)) ?? result.supplier) : result.supplier;
    await record(request, "supplier.created", supplier.id, { name: supplier.name, ...(needsLogin === false ? { needsLogin: false } : {}) });
    return reply.status(201).send({ supplier: await decorate(supplier) });
  });

  // Only when the last connection check finished. The page asks this while a check goes, then reads the supplier once.
  app.get<{ Params: { id: string } }>("/api/suppliers/:id/status", async (request) => {
    const supplier = await repo.get(request.params.id);
    if (!supplier) throw NOT_FOUND();
    return { checkedAt: supplier.lastSessionCheckAt };
  });

  app.get<{ Params: { id: string } }>("/api/suppliers/:id", async (request) => {
    const supplier = await repo.get(request.params.id);
    if (!supplier) throw NOT_FOUND();
    return { supplier: await decorate(supplier) };
  });

  app.patch<{ Params: { id: string } }>("/api/suppliers/:id", async (request) => {
    const body = typeof request.body === "object" && request.body !== null && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : null;
    // Whether the supplier's pages need a login: set on its own after the other fields, so a refused field changes nothing.
    let needsLogin: boolean | undefined;
    let sent: unknown = request.body;
    if (body && "needsLogin" in body) {
      if (typeof body.needsLogin !== "boolean") throw new AppError(400, "invalid_input", "Check the supplier details and try again.");
      needsLogin = body.needsLogin;
      const others = Object.fromEntries(Object.entries(body).filter(([k]) => k !== "needsLogin"));
      if (Object.keys(others).length === 0) {
        const updated = await repo.setNeedsLogin(request.params.id, needsLogin);
        if (!updated) throw NOT_FOUND();
        await record(request, "supplier.updated", updated.id, { changed: ["needsLogin"] });
        return { supplier: await decorate(updated) };
      }
      sent = others;
    }
    const input = body && sent !== request.body ? (sent as Record<string, unknown>) : body;
    const auto: Parameters<Repository["setAutoLogin"]>[1] = {};
    let rest: unknown = sent;
    if (input && AUTO_LOGIN_BODY.some((k) => k in input)) {
      const invalid = () => new AppError(400, "invalid_input", "Check the supplier details and try again.");
      if ("autoLogin" in input) {
        if (typeof input.autoLogin !== "boolean") throw invalid();
        auto.autoLogin = input.autoLogin;
      }
      if ("stealth" in input) {
        if (typeof input.stealth !== "boolean") throw invalid();
        auto.stealth = input.stealth;
      }
      if ("freshProfile" in input) {
        if (typeof input.freshProfile !== "boolean") throw invalid();
        auto.freshProfile = input.freshProfile;
      }
      if ("loginSelectors" in input) {
        if (input.loginSelectors !== null && !isLoginSelectors(input.loginSelectors)) throw invalid();
        auto.loginSelectors = input.loginSelectors as typeof auto.loginSelectors;
      }
      if ("loggedInMarker" in input) {
        const marker = input.loggedInMarker;
        if (marker !== null && typeof marker !== "string") throw invalid();
        // A page's text is matched without the spaces around it, so a marker of only spaces is refused, not saved as a marker that is ignored.
        const trimmed = marker === null ? null : marker.trim();
        if (trimmed !== null && (trimmed.length < 1 || trimmed.length > 200)) throw invalid();
        auto.loggedInMarker = trimmed;
      }
      if ("codeEmailFrom" in input) {
        const sender = input.codeEmailFrom;
        if (sender !== null && typeof sender !== "string") throw invalid();
        const clean = sender === null ? null : sender.trim().toLowerCase();
        if (clean !== null && (clean.length < 3 || clean.length > 254 || !SENDER.test(clean))) throw invalid();
        auto.codeEmailFrom = clean;
      }
      rest = Object.fromEntries(Object.entries(input).filter(([k]) => !AUTO_LOGIN_BODY.includes(k)));
    }
    const hasRest = !(typeof rest === "object" && rest !== null && Object.keys(rest).length === 0 && Object.keys(auto).length > 0);
    const values = hasRest ? await checked(rest, true) : {};
    // Refuse before anything is written, so a refused request changes nothing.
    if (auto.autoLogin || auto.stealth || auto.freshProfile) {
      const current = await repo.get(request.params.id);
      if (!current) throw NOT_FOUND();
      if (auto.autoLogin && credentials && !(await credentials.savedAt(current.id))) throw NO_CREDENTIALS();
      if (current.automationPermission !== "granted") throw NOT_GRANTED();
    }
    if (!hasRest || Object.keys(values).length > 0) {
      const result = await repo.update(request.params.id, values);
      if (!result.ok) throw taken(result.reason);
    }
    let latest = (await repo.get(request.params.id)) ?? null;
    if (Object.keys(auto).length > 0) {
      // Credentials are checked first so the owner is told to save them before anything else.
      if (auto.autoLogin && credentials && !(await credentials.savedAt(request.params.id))) throw NO_CREDENTIALS();
      const result = await repo.setAutoLogin(request.params.id, auto);
      if (!result.ok) {
        if (result.reason === "not_granted") throw NOT_GRANTED();
        if (result.reason === "no_credentials") throw NO_CREDENTIALS();
        throw NOT_FOUND();
      }
      latest = result.supplier;
    }
    if (latest && needsLogin !== undefined) latest = await repo.setNeedsLogin(latest.id, needsLogin);
    if (!latest) throw NOT_FOUND();
    await record(request, "supplier.updated", latest.id, { changed: [...Object.keys(values), ...Object.keys(auto), ...(needsLogin === undefined ? [] : ["needsLogin"])] });
    return { supplier: await decorate(latest) };
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

  const { key, queue } = deps;
  if (!credentials || !key || !queue) return;

  // One test login a minute per supplier. The limiter counts every call as a failure so the second is blocked.
  const testLimiter = createLoginLimiter({ maxFailures: 1, windowMs: 60_000 });

  app.put<{ Params: { id: string } }>("/api/suppliers/:id/credentials", async (request) => {
    const body = request.body;
    if (!isCredentials(body)) throw new AppError(400, "invalid_input", "Enter a username and a password, up to 200 characters each.");
    if (!(await repo.get(request.params.id))) throw NOT_FOUND();
    const { savedAt } = await credentials.save(request.params.id, sealCredentials(body, key.key, key.keyId));
    await record(request, "supplier.credentials_saved", request.params.id);
    return { savedAt };
  });

  app.delete<{ Params: { id: string } }>("/api/suppliers/:id/credentials", async (request, reply) => {
    if (!(await repo.get(request.params.id))) throw NOT_FOUND();
    await credentials.remove(request.params.id);
    await repo.setAutoLogin(request.params.id, { autoLogin: false });
    await record(request, "supplier.credentials_removed", request.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/suppliers/:id/auto-login/test", async (request, reply) => {
    const id = request.params.id;
    if (!(await repo.get(id))) throw NOT_FOUND();
    if (testLimiter.isBlocked(id)) throw new AppError(429, "too_many_requests", "Wait a minute before testing the login again.");
    testLimiter.recordFailure(id);
    try {
      await queue.enqueue("supplier.session.login", { supplierId: id }, { retryLimit: 0 });
    } catch {
      testLimiter.reset(id);
      throw new AppError(503, "queue_unavailable", "Could not start that. Try again in a minute.");
    }
    return reply.status(202).send({ queued: true });
  });

  // Looks at the supplier's login page and says what a login would use there. Nothing is typed or sent, and no credentials are involved.
  const { browser } = deps;
  if (browser) {
    app.post<{ Params: { id: string } }>("/api/suppliers/:id/auto-login/inspect", async (request) => {
      const body = request.body;
      if (body !== undefined && body !== null && !(typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0)) throw new AppError(400, "invalid_input", "Check the details and try again.");
      const supplier = await repo.get(request.params.id);
      if (!supplier) throw NOT_FOUND();
      if (supplier.automationPermission !== "granted") throw NOT_GRANTED();
      const answer = await browser.inspectLogin({
        loginUrl: supplier.loginUrl ?? supplier.websiteUrl,
        checkUrl: supplier.websiteUrl,
        stealth: supplier.stealth,
        ...(supplier.loginSelectors ? { selectors: supplier.loginSelectors } : {}),
      });
      if (!answer.ok) throw new AppError(503, "browser_unavailable", "The browser service did not answer. Try again in a minute.");
      const { inspection } = answer;
      // Counts and the state only: the labels and selectors belong to the owner's screen, not the audit trail.
      await record(request, "supplier.login_inspected", supplier.id, {
        state: inspection.state,
        found: Object.values(inspection.found).filter((c) => c !== null).length,
        fields: inspection.fields.length,
        buttons: inspection.buttons.length,
      });
      return { inspection };
    });
  }

  app.post<{ Params: { id: string } }>("/api/suppliers/:id/auto-login/resume", async (request, reply) => {
    if (!(await repo.resumeAutoLogin(request.params.id))) throw NOT_FOUND();
    await record(request, "supplier.auto_login_resumed", request.params.id);
    return reply.status(204).send();
  });
}
