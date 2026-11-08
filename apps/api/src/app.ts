import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import { AppError, unauthenticated } from "./errors.js";
import { SESSION_COOKIE, findSessionUser, type SessionUser } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

// Routes that work without a login. Everything else needs a valid session.
const PUBLIC_ROUTES = new Set(["/health"]);

export type AppDeps = { db: NodePgDatabase<Record<string, unknown>>; logger: Logger };

export function buildApp({ db, logger }: AppDeps) {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  });

  app.register(cookie);
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    const path = request.url.split("?")[0] ?? "";
    if (PUBLIC_ROUTES.has(path)) return;
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

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(body("not_found", "That page or action does not exist.", request.id)),
  );

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/me", async (request) => ({ email: request.user?.email }));

  return app;
}
