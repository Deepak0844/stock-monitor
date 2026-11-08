import { connect } from "node:net";
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createWebSocketStream } from "ws";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createLoginSessionRepository } from "@stock-monitor/db";
import { createLoginLimiter } from "../rate-limit.js";
import { AppError } from "../errors.js";
import { SESSION_COOKIE, findSessionUser } from "../sessions.js";
import type { LoginSessions } from "./login-sessions.js";

type Audit = ReturnType<typeof createAuditWriter>;

export type LoginScreenDeps = {
  /** The origins a page may open the screen from, spelled exactly as a browser sends them, for example https://stock.example.com. */
  allowedOrigins: string[];
  /** The browser container's VNC port, reachable only over the private network. */
  vnc: { host: string; port: number };
  /** How long a new connection may stay silent before it is closed. */
  firstMessageTimeoutMs?: number;
  /** Failed attempts allowed from one address in five minutes. */
  maxFailures?: number;
};

/** Keeps track of open screen connections so they can be closed when their login ends. */
export type ScreenRegistry = {
  add(loginSessionId: string, close: () => void): () => void;
  closeFor(loginSessionId: string): void;
};

export function createScreenRegistry(): ScreenRegistry {
  const open = new Map<string, Set<() => void>>();
  return {
    add(id, close) {
      const set = open.get(id) ?? new Set();
      set.add(close);
      open.set(id, set);
      return () => void set.delete(close);
    },
    closeFor(id) {
      for (const close of open.get(id) ?? []) close();
      open.delete(id);
    },
  };
}

// Why a connection was refused. These go in the audit trail and nowhere else: the page is only ever told "refused".
type Reason =
  | "rate_limited" | "no_session" | "bad_origin"
  | "timeout" | "bad_message" | "token_invalid" | "token_used" | "token_expired" | "token_not_ready"
  | "vnc_unreachable";

const MAX_TOKEN_MESSAGE = 100; // a token is 64 characters
const DEFAULT_FIRST_MESSAGE_MS = 5_000;
const POLICY_VIOLATION = 1008;
const INTERNAL_ERROR = 1011;

type Deps = {
  screen: LoginScreenDeps;
  db: NodePgDatabase<Record<string, unknown>>;
  loginSessions: ReturnType<typeof createLoginSessionRepository>;
  logins: LoginSessions;
  audit: Audit;
  registry: ScreenRegistry;
};

/**
 * The owner's way into the live login window. A connection needs, in this order: a signed-in owner, an
 * allowed Origin (so another website cannot drive it with the owner's cookie), and the login's one-time
 * token as its FIRST MESSAGE, never in the address. Only then is anything behind the proxy contacted.
 * Every refusal is audited, repeated failures are slowed down, and no byte of the screen is logged.
 */
export async function registerLoginScreen(app: FastifyInstance, deps: Deps): Promise<void> {
  const { screen, db, loginSessions, logins, audit, registry } = deps;
  const limiter = createLoginLimiter({ maxFailures: screen.maxFailures ?? 10, windowMs: 5 * 60_000 });
  await app.register(websocket, { options: { maxPayload: 1_048_576 } });

  const refuse = (request: { id: string; params: unknown }, reason: Reason, userId?: string) =>
    audit
      .record({
        actorUserId: userId,
        action: "login_session.screen_refused",
        entityType: "login_session",
        entityId: String((request.params as { id?: string }).id ?? "").slice(0, 64),
        details: { reason },
        requestId: request.id,
      })
      .catch(() => {});

  app.get<{ Params: { id: string } }>(
    "/api/login-sessions/:id/screen",
    {
      websocket: true,
      // These run before the connection is upgraded, so a refusal is a plain HTTP error and no socket is ever opened.
      onRequest: async (request) => {
        const ip = request.ip;
        if (limiter.isBlocked(ip)) {
          await refuse(request, "rate_limited");
          throw new AppError(429, "too_many_attempts", "Too many attempts. Please wait a few minutes and try again.");
        }
        const cookie = request.cookies[SESSION_COOKIE];
        const user = cookie ? await findSessionUser(db, cookie) : null;
        if (!user) {
          limiter.recordFailure(ip);
          await refuse(request, "no_session");
          throw new AppError(401, "unauthenticated", "Please sign in to continue.");
        }
        const origin = request.headers.origin;
        if (!origin || !screen.allowedOrigins.includes(origin)) {
          limiter.recordFailure(ip);
          await refuse(request, "bad_origin", user.id);
          throw new AppError(403, "forbidden", "This page is not allowed to open the screen.");
        }
        request.user = user;
      },
    },
    (socket, request) => {
      const id = request.params.id;
      const ip = request.ip;
      const userId = request.user?.id;
      let finished = false;

      const deny = async (reason: Reason, code = POLICY_VIOLATION) => {
        if (finished) return;
        finished = true;
        clearTimeout(silence);
        limiter.recordFailure(ip);
        await refuse(request, reason, userId); // written before the page hears anything
        socket.close(code, "refused");
      };
      // A connection that never sends the token is closed, so it cannot hold a place open.
      const silence = setTimeout(() => void deny("timeout"), screen.firstMessageTimeoutMs ?? DEFAULT_FIRST_MESSAGE_MS);
      socket.once("close", () => clearTimeout(silence));
      socket.on("error", () => socket.terminate());

      socket.once("message", async (data, isBinary) => {
        clearTimeout(silence);
        const text = isBinary ? null : data.toString();
        if (text === null || text.length > MAX_TOKEN_MESSAGE) return deny("bad_message");
        const used = await loginSessions.consumeToken(id, text);
        if (!used.ok) return deny(`token_${used.reason}`);
        limiter.reset(ip);

        // The token is good. Only now is the browser container's screen contacted.
        const vnc = connect({ host: screen.vnc.host, port: screen.vnc.port });
        let connected = false;
        vnc.once("connect", async () => {
          connected = true;
          const password = logins.vncPassword(id);
          socket.send(JSON.stringify({ type: "ready", ...(password ? { vncPassword: password } : {}) }));
          await audit
            .record({ actorUserId: userId, action: "login_session.screen_connected", entityType: "login_session", entityId: id, requestId: request.id })
            .catch(() => {});
          const stream = createWebSocketStream(socket);
          stream.pipe(vnc);
          vnc.pipe(stream);
          stream.on("error", () => vnc.destroy());
          const forget = registry.add(id, () => socket.close(1000, "login ended"));
          socket.once("close", () => {
            forget();
            vnc.destroy();
          });
          vnc.once("close", () => socket.close(1000, "screen closed"));
        });
        vnc.on("error", () => {
          // Only the fact is recorded. Never the address or anything the screen carried.
          if (!connected) void deny("vnc_unreachable", INTERNAL_ERROR);
          else socket.terminate();
        });
      });
    },
  );
}
