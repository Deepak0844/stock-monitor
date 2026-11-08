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
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const isApiPath = (path: string) => path === "/api" || path.startsWith("/api/");

const loginBody = z.object({ email: z.string().min(1), password: z.string().min(1) });

export function buildApp({ db, logger, secureCookies = false, webRoot }: AppDeps) {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  });

  app.register(cookie);
  if (webRoot) app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.headers(SECURITY_HEADERS);
    const path = request.url.split("?")[0] ?? "";
    if (PUBLIC_ROUTES.has(path)) return;
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

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/me", async (request) => ({ email: request.user?.email }));

  return app;
}
