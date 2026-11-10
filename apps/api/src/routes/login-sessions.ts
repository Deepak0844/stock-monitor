import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createLoginSessionRepository, createNotificationRepository, createSupplierRepository, createSupplierSessionRepository, FailureReason, LoginSessionRecord } from "@stock-monitor/db";
import type { Queue } from "@stock-monitor/queue";
import { createLoginToken, sealSessionState } from "@stock-monitor/supplier-session";
import type { BrowserClient } from "@stock-monitor/browser-client";
import { AppError } from "../errors.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;
type Audit = ReturnType<typeof createAuditWriter>;

export type LoginSessionRoutesDeps = {
  suppliers: ReturnType<typeof createSupplierRepository>;
  loginSessions: ReturnType<typeof createLoginSessionRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  browser: BrowserClient;
  notifications: ReturnType<typeof createNotificationRepository>;
  /** Queues the check that follows a login. The job carries only the supplier's id. */
  queue: Pick<Queue, "enqueue">;
  /** Seals saved sessions. The browser service never sees it. */
  key: { key: Buffer; keyId: string };
  /** Called whenever a login stops being open (finished, cancelled, failed or expired), so its screen connections can be closed. */
  onEnded?: (loginSessionId: string) => void;
};

/** What the rest of the API may ask of the login routes. */
export type LoginSessions = {
  /** Ends any open login for this supplier and closes its window, for when the supplier is deleted. */
  cancelOpenFor(supplierId: string): Promise<void>;
  /** The VNC password for an open login, for the screen proxy. null once the login has ended or after a restart. */
  vncPassword(loginSessionId: string): string | null;
};

const TOKEN_MINUTES = 10;
const NOT_FOUND = () => new AppError(404, "login_session_not_found", "That login does not exist.");
const SUPPLIER_NOT_FOUND = () => new AppError(404, "supplier_not_found", "That supplier does not exist.");
const LOGIN_OPEN = () => new AppError(409, "login_open", "A login window is already open. Finish or cancel it first.");
const NOT_OPEN = () => new AppError(409, "login_not_open", "This login is no longer open. Start the login again.");
const OPEN = ["starting", "ready", "connected"] as const;

// What each way of failing is called in the database, and what the owner is told.
const START_FAILURES = {
  busy: { reason: "window_already_open", error: LOGIN_OPEN },
  failed: { reason: "window_failed", error: () => new AppError(502, "window_failed", "The login window could not be opened. Please try again.") },
  unavailable: { reason: "browser_unavailable", error: () => new AppError(503, "browser_unavailable", "The browser service is not available right now. Please try again in a minute.") },
} as const;

const view = (s: LoginSessionRecord) => ({
  id: s.id,
  supplierId: s.supplierId,
  status: s.status,
  failureReason: s.failureReason,
  createdAt: s.createdAt,
  tokenExpiresAt: s.tokenExpiresAt,
  expiresAt: s.expiresAt,
});

export function registerLoginSessionRoutes(app: App, deps: LoginSessionRoutesDeps, audit: Audit): LoginSessions {
  const { suppliers, loginSessions, supplierSessions, browser, key, notifications, queue } = deps;
  const vnc = new Map<string, string>();
  const ended = (id: string) => {
    vnc.delete(id);
    deps.onEnded?.(id);
  };

  const record = (request: { user: { id: string } | null; id: string }, action: string, id: string, details: Record<string, unknown>) =>
    audit.record({ actorUserId: request.user?.id, action, entityType: "login_session", entityId: id, details, requestId: request.id });

  /** Marks attempts that ran out of time, and makes sure their windows are closed. */
  async function sweep() {
    for (const expired of await loginSessions.expireOverdue()) {
      ended(expired.id);
      if (expired.browserSessionId) await browser.cancelSession(expired.browserSessionId);
    }
  }

  async function failAttempt(request: Parameters<typeof record>[0], attempt: LoginSessionRecord, reason: FailureReason) {
    await loginSessions.fail(attempt.id, reason);
    ended(attempt.id);
    await record(request, "login_session.failed", attempt.id, { supplierId: attempt.supplierId, reason });
  }

  app.post<{ Params: { id: string } }>("/api/suppliers/:id/login-session", async (request, reply) => {
    const supplier = await suppliers.get(request.params.id);
    if (!supplier) throw SUPPLIER_NOT_FOUND();
    await sweep();

    const { token, hash } = createLoginToken();
    const created = await loginSessions.create({
      supplierId: supplier.id,
      tokenHash: hash,
      tokenExpiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000),
      startedBy: request.user?.id ?? null,
    });
    if (!created.ok) throw LOGIN_OPEN();
    const attempt = created.session;

    const opened = await browser.openSession(supplier.loginUrl ?? supplier.websiteUrl);
    if (!opened.ok) {
      const failure = START_FAILURES[opened.reason];
      await failAttempt(request, attempt, failure.reason);
      throw failure.error();
    }
    if (!(await loginSessions.markReady(attempt.id, { browserSessionId: opened.id, expiresAt: new Date(opened.expiresAt) }))) {
      await browser.cancelSession(opened.id); // the attempt ended while the window was opening
      throw NOT_OPEN();
    }
    if (opened.vncPassword) vnc.set(attempt.id, opened.vncPassword);

    await record(request, "login_session.started", attempt.id, { supplierId: supplier.id });
    const ready = (await loginSessions.get(attempt.id)) as LoginSessionRecord;
    // The token is handed over here and nowhere else. Only its hash is kept.
    return reply.status(201).send({ loginSession: view(ready), token });
  });

  app.get<{ Params: { id: string } }>("/api/login-sessions/:id", async (request) => {
    await sweep();
    const attempt = await loginSessions.get(request.params.id);
    if (!attempt) throw NOT_FOUND();
    return { loginSession: view(attempt) };
  });

  app.post<{ Params: { id: string } }>("/api/login-sessions/:id/finish", async (request) => {
    await sweep();
    const attempt = await loginSessions.get(request.params.id);
    if (!attempt) throw NOT_FOUND();
    if (!OPEN.includes(attempt.status as (typeof OPEN)[number]) || attempt.status === "starting" || !attempt.browserSessionId) throw NOT_OPEN();
    if (!(await loginSessions.beginSaving(attempt.id))) throw NOT_OPEN();

    const finished = await browser.finishSession(attempt.browserSessionId);
    if (!finished.ok) {
      const reason: FailureReason = finished.reason === "unavailable" ? "browser_unavailable" : finished.reason === "not_found" ? "window_failed" : "read_failed";
      await failAttempt(request, attempt, reason);
      if (finished.reason === "not_found") throw new AppError(409, "login_window_closed", "The login window has closed. Start the login again.");
      if (finished.reason === "unavailable") throw START_FAILURES.unavailable.error();
      throw new AppError(502, "read_failed", "The login could not be read from the window. Start the login again.");
    }

    const { state } = finished;
    if (state.cookies.length === 0 && state.origins.length === 0) {
      await failAttempt(request, attempt, "save_failed");
      throw new AppError(422, "nothing_to_save", "No login was found in the window. Log in to the supplier, then press I'm logged in. Start the login again to try again.");
    }
    try {
      await supplierSessions.save(attempt.supplierId, sealSessionState(state, key.key, key.keyId), state);
      if (!(await suppliers.markConnected(attempt.supplierId))) throw new Error("supplier missing");
    } catch {
      await supplierSessions.remove(attempt.supplierId).catch(() => {}); // never leave a session saved for a supplier that is not marked connected
      await failAttempt(request, attempt, "save_failed");
      throw new AppError(500, "save_failed", "The login could not be saved. Start the login again.");
    }

    await loginSessions.finish(attempt.id);
    ended(attempt.id);
    // The supplier has a working login again, so whatever was asking for one is no longer true.
    await notifications.resolve("supplier_needs_reconnect", attempt.supplierId);
    // A first check, to see that the saved login really works. If the queue is down the login still stands.
    await queue.enqueue("supplier.session.verify", { supplierId: attempt.supplierId }).catch(() => {});
    const facts = await supplierSessions.facts(attempt.supplierId);
    await record(request, "login_session.finished", attempt.id, { supplierId: attempt.supplierId, savedItems: facts?.cookieCount ?? 0 });
    return { loginSession: view((await loginSessions.get(attempt.id)) as LoginSessionRecord), session: facts };
  });

  async function cancelAttempt(request: Parameters<typeof record>[0] | null, attempt: LoginSessionRecord) {
    if (!(await loginSessions.cancel(attempt.id))) return;
    ended(attempt.id);
    if (attempt.browserSessionId) await browser.cancelSession(attempt.browserSessionId); // best effort: the window also closes by itself
    if (request) await record(request, "login_session.cancelled", attempt.id, { supplierId: attempt.supplierId });
  }

  app.post<{ Params: { id: string } }>("/api/login-sessions/:id/cancel", async (request) => {
    await sweep();
    const attempt = await loginSessions.get(request.params.id);
    if (!attempt) throw NOT_FOUND();
    // A login that is already over, or is being saved, is left as it is: cancelling twice is harmless.
    if (OPEN.includes(attempt.status as (typeof OPEN)[number])) await cancelAttempt(request, attempt);
    return { loginSession: view((await loginSessions.get(attempt.id)) as LoginSessionRecord) };
  });

  app.get<{ Params: { id: string } }>("/api/suppliers/:id/session", async (request) => {
    if (!(await suppliers.get(request.params.id))) throw SUPPLIER_NOT_FOUND();
    return { session: await supplierSessions.facts(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/suppliers/:id/check-session", async (request, reply) => {
    if (!(await suppliers.get(request.params.id))) throw SUPPLIER_NOT_FOUND();
    if (!(await supplierSessions.facts(request.params.id))) throw new AppError(409, "not_connected", "Connect this supplier first.");
    try {
      await queue.enqueue("supplier.session.verify", { supplierId: request.params.id });
    } catch {
      throw new AppError(503, "check_not_started", "The check could not be started. Please try again in a minute.");
    }
    await audit.record({ actorUserId: request.user?.id, action: "supplier.session_check_requested", entityType: "supplier", entityId: request.params.id, requestId: request.id });
    return reply.status(202).send({ queued: true });
  });

  app.delete<{ Params: { id: string } }>("/api/suppliers/:id/session", async (request) => {
    if (!(await suppliers.get(request.params.id))) throw SUPPLIER_NOT_FOUND();
    if (!(await supplierSessions.remove(request.params.id))) throw new AppError(404, "session_not_found", "This supplier has no saved login.");
    await suppliers.markNotConnected(request.params.id);
    await audit.record({ actorUserId: request.user?.id, action: "supplier.disconnected", entityType: "supplier", entityId: request.params.id, requestId: request.id });
    return { ok: true };
  });

  return {
    async cancelOpenFor(supplierId) {
      const open = await loginSessions.open();
      if (open && open.supplierId === supplierId) await cancelAttempt(null, open);
    },
    vncPassword: (id) => vnc.get(id) ?? null,
  };
}
