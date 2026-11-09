import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { registerShopifyRoutes, type ShopifyRoutesDeps } from "./routes/shopify.js";
import { registerNotificationRoutes, type NotificationRoutesDeps } from "./routes/notifications.js";
import { createScreenRegistry, registerLoginScreen, type LoginScreenDeps } from "./routes/login-screen.js";
import { registerLoginSessionRoutes, type LoginSessionRoutesDeps } from "./routes/login-sessions.js";
import { registerMappingRoutes, type MappingRoutesDeps } from "./routes/mappings.js";
import { registerSupplierRoutes, type SupplierRoutesDeps } from "./routes/suppliers.js";
import { AppError, unauthenticated } from "./errors.js";
import { createLoginLimiter } from "./rate-limit.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  deleteSession,
  findSessionUser,
  type SessionUser,
} from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

// Routes that work without a login. Everything else needs a valid session.
const PUBLIC_ROUTES = new Set(["/health", "/api/login"]);

export type AppDeps = {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  /** Set true in production so the session cookie is only sent over HTTPS. */
  secureCookies?: boolean;
  /** Folder holding the built web app. When set, the API serves it from the same origin. */
  webRoot?: string;
  /** Believe X-Forwarded-For for the client address. Off unless a trusted proxy sits in front. */
  trustProxy?: boolean;
  /** Shopify routes. Left out, the API has no /api/shopify routes. */
  shopify?: ShopifyRoutesDeps;
  /** Supplier routes. Left out, the API has no /api/suppliers routes. */
  suppliers?: SupplierRoutesDeps;
  /** Login routes. They need the suppliers and a browser service. Left out, the API has no /api/login-sessions routes. */
  loginSessions?: LoginSessionRoutesDeps;
  /** The live screen. Needs `loginSessions`. Left out, there is no way to reach a login window. */
  loginScreen?: LoginScreenDeps;
  /** What needs the owner's attention. Left out, there are no /api/notifications routes. */
  notifications?: NotificationRoutesDeps;
  /** Mapping routes and the supplier permission record. Left out, there are no /api/mappings routes. */
  mappings?: MappingRoutesDeps;
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// The screen checks the owner's cookie, the Origin and the token itself, so that every refusal can be audited. Its own
// tests prove that a request with no cookie or the wrong Origin is refused before any socket is opened.
const isScreenPath = (path: string) => /^\/api\/login-sessions\/[^/]+\/screen$/.test(path);

const isApiPath = (path: string) => path === "/api" || path.startsWith("/api/");

const loginBody = z.object({ email: z.string().min(1), password: z.string().min(1) });

export function buildApp({ db, logger, secureCookies = false, webRoot, trustProxy = false, shopify, suppliers, loginSessions, loginScreen, notifications, mappings }: AppDeps) {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy,
  });

  app.register(cookie);
  if (webRoot) app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.headers(SECURITY_HEADERS);
    const path = request.url.split("?")[0] ?? "";
    if (PUBLIC_ROUTES.has(path) || (loginScreen && isScreenPath(path))) return;
    // The web app's own files and pages are public. Only the API needs a session.
    if (webRoot && !isApiPath(path) && (request.method === "GET" || request.method === "HEAD")) return;
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await findSessionUser(db, token) : null;
    if (!user) throw unauthenticated();
    request.user = user;
  });

  const body = (code: string, message: string, requestId: string) => ({
    error: { code, message, requestId },
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(body(err.code, err.message, request.id));
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send(body("bad_request", "The request was not valid.", request.id));
    }
    request.log.error({ err }, "unhandled error");
    return reply
      .status(500)
      .send(body("internal_error", "Something went wrong. Please try again.", request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (webRoot && request.method === "GET" && !isApiPath(path)) {
      // Single-page app: any other address loads the app, which then shows the right screen.
      return reply.sendFile("index.html");
    }
    return reply.status(404).send(body("not_found", "That page or action does not exist.", request.id));
  });

  const audit = createAuditWriter(db);
  const limiter = createLoginLimiter({ maxFailures: 5, windowMs: 15 * 60_000 });
  // Verified when the email is unknown, so a missing account takes as long as a wrong password.
  const dummyHash = hash("timing-equaliser-password");

  app.post("/api/login", async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, "invalid_input", "Enter your email and password.");
    }
    const email = parsed.data.email.trim().toLowerCase();
    const key = `${request.ip}|${email}`;
    if (limiter.isBlocked(key)) {
      throw new AppError(
        429,
        "too_many_attempts",
        "Too many sign-in attempts. Please wait a few minutes and try again.",
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const ok = await verify(user?.passwordHash ?? (await dummyHash), parsed.data.password).catch(
      () => false,
    );
    if (!user || !ok) {
      limiter.recordFailure(key);
      await audit.record({
        action: "login.failed",
        entityType: "user",
        details: { email },
        requestId: request.id,
      });
      throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
    }

    limiter.reset(key);
    const token = await createSession(db, user.id);
    await audit.record({
      actorUserId: user.id,
      action: "login.succeeded",
      entityType: "user",
      entityId: user.id,
      requestId: request.id,
    });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: secureCookies,
      maxAge: SESSION_TTL_MS / 1000,
    });
    return { email: user.email };
  });

  app.post("/api/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    await audit.record({
      actorUserId: request.user?.id,
      action: "logout",
      entityType: "user",
      entityId: request.user?.id,
      requestId: request.id,
    });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  if (shopify) registerShopifyRoutes(app, shopify, audit);
  if (notifications) registerNotificationRoutes(app, notifications);
  if (mappings) registerMappingRoutes(app, mappings, audit);
  const screens = createScreenRegistry();
  const logins = loginSessions ? registerLoginSessionRoutes(app, { ...loginSessions, onEnded: screens.closeFor }, audit) : null;
  if (logins && loginSessions && loginScreen) {
    app.register(async (scope) =>
      registerLoginScreen(scope, { screen: loginScreen, db, loginSessions: loginSessions.loginSessions, logins, audit, registry: screens }),
    );
  }
  if (suppliers) registerSupplierRoutes(app, { ...suppliers, beforeDelete: logins?.cancelOpenFor }, audit);

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/me", async (request) => ({ email: request.user?.email }));

  return app;
}
