import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isLoginSelectors, isSessionState, type SessionState } from "@stock-monitor/supplier-session";
import type { CaptureOutcome, CaptureRequest } from "./capture.js";
import type { LoginOutcome, LoginRequest } from "./login.js";
import type { CheckPageOutcome, CheckPageRequest, VerifyOutcome, VerifyRequest } from "./verify.js";

export type VerifyFn = (request: VerifyRequest) => Promise<VerifyOutcome>;
export type CheckPageFn = (request: CheckPageRequest) => Promise<CheckPageOutcome>;
export type CaptureFn = (request: CaptureRequest) => Promise<CaptureOutcome>;
export type LoginFn = (request: LoginRequest) => Promise<LoginOutcome>;
export type SessionsApi = {
  open(url: string, options: { stealth: boolean }): Promise<{ ok: true; id: string; expiresAt: string } | { ok: false; reason: "busy" | "failed" }>;
  /** The saved session, with the window closed. null when there is no such open window. */
  finish(id: string): Promise<SessionState | null>;
  cancel(id: string): Promise<boolean>;
};
export type ControlServerOptions = {
  /** Every call except /health must carry this as a Bearer token. */
  token: string;
  verify: VerifyFn;
  /** Loads one page with a saved session and says what happened to the link. Left out, there is no /check-page route. */
  checkPage?: CheckPageFn;
  /** Loads one page with a saved session and describes it (and can draw it). Left out, there is no /capture route. */
  capture?: CaptureFn;
  /** Signs in to a supplier with a username and password. Left out, there is no /login route. */
  login?: LoginFn;
  /** The live login window. Left out, the service has no /sessions routes. */
  sessions?: SessionsApi;
  /** Handed to the caller with each new window, so it can log in to the shared screen. */
  vncPassword?: string;
  log?: (line: string) => void;
  maxBodyBytes?: number;
};

const MAX_URL = 2048;
const digest = (s: string) => createHash("sha256").update(s).digest();

const isWebUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > MAX_URL) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const MAX_TEXT = 200;
const isText = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= MAX_TEXT;

/** Reads the request body, or returns null once it is larger than the limit (the rest is thrown away). */
async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      req.resume();
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parse(raw: string): (VerifyRequest & { picture?: boolean; stealth?: boolean }) | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { url, loginUrl, state, picture, loggedInMarker, stealth } = body as Record<string, unknown>;
  if (!isWebUrl(url) || !isSessionState(state)) return null;
  if (loginUrl !== undefined && (typeof loginUrl !== "string" || loginUrl.length > MAX_URL)) return null;
  if (picture !== undefined && typeof picture !== "boolean") return null;
  if (stealth !== undefined && typeof stealth !== "boolean") return null;
  if (loggedInMarker !== undefined && !isText(loggedInMarker)) return null;
  return {
    url,
    state,
    ...(loginUrl === undefined ? {} : { loginUrl }),
    ...(picture === undefined ? {} : { picture }),
    ...(stealth === undefined ? {} : { stealth }),
    ...(loggedInMarker === undefined ? {} : { loggedInMarker }),
  };
}

/** Exactly the login fields and nothing else. The password is only ever read here and handed on. */
export function parseLogin(raw: string): LoginRequest | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const allowed = ["loginUrl", "checkUrl", "username", "password", "account", "stealth", "selectors", "loggedInMarker"];
  if (!Object.keys(b).every((k) => allowed.includes(k))) return null;
  if (!isWebUrl(b.loginUrl) || !isWebUrl(b.checkUrl) || !isText(b.username) || !isText(b.password)) return null;
  if (b.account !== undefined && !isText(b.account)) return null;
  if (typeof b.stealth !== "boolean") return null;
  if (b.selectors !== undefined && !isLoginSelectors(b.selectors)) return null;
  if (b.loggedInMarker !== undefined && !isText(b.loggedInMarker)) return null;
  return {
    loginUrl: b.loginUrl,
    checkUrl: b.checkUrl,
    username: b.username,
    password: b.password,
    ...(b.account === undefined ? {} : { account: b.account }),
    stealth: b.stealth,
    ...(b.selectors === undefined ? {} : { selectors: b.selectors }),
    ...(b.loggedInMarker === undefined ? {} : { loggedInMarker: b.loggedInMarker }),
  };
}

const SESSION_PATH = /^\/sessions(?:\/([^/]+?)(\/finish)?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The service's only door. Plain HTTP on the private network: the caller proves itself with the control token. */
export function createControlServer({ token, verify, checkPage, capture, login, sessions, vncPassword, log = () => {}, maxBodyBytes = 5_000_000 }: ControlServerOptions): Server {
  const tokenDigest = digest(token);
  const authorised = (header: string | undefined) => {
    const given = /^Bearer (.+)$/.exec(header ?? "")?.[1];
    return given !== undefined && timingSafeEqual(digest(given), tokenDigest);
  };
  const reply = (res: ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...extra });
    res.end(JSON.stringify(payload));
  };

  const NOT_FOUND = { error: "session_not_found" };

  /** /sessions (open), /sessions/:id/finish and /sessions/:id (cancel). */
  async function handleSession(api: SessionsApi, req: IncomingMessage, res: ServerResponse, id: string | undefined, finish: boolean) {
    try {
      if (id === undefined && req.method === "POST") {
        const raw = await readBody(req, 10_000);
        let body: unknown;
        try {
          body = raw === null ? null : JSON.parse(raw);
        } catch {
          body = null;
        }
        const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { url?: unknown; stealth?: unknown }) : {};
        const { url, stealth = false } = Object.keys(fields).every((k) => k === "url" || k === "stealth") ? fields : {};
        if (!isWebUrl(url) || typeof stealth !== "boolean") return reply(res, 400, { error: "invalid_request" });
        const opened = await api.open(url, { stealth });
        if (opened.ok) return reply(res, 201, { id: opened.id, expiresAt: opened.expiresAt, ...(vncPassword ? { vncPassword } : {}) });
        if (opened.reason === "busy") {
          return reply(res, 409, { error: "session_open", message: "A login window is already open. Finish or cancel it first." });
        }
        return reply(res, 502, { error: "window_failed" });
      }
      req.resume(); // these calls have no body
      if (id !== undefined && UUID.test(id) && finish && req.method === "POST") {
        const state = await api.finish(id);
        return state ? reply(res, 200, { state }) : reply(res, 404, NOT_FOUND);
      }
      if (id !== undefined && UUID.test(id) && !finish && req.method === "DELETE") {
        if (await api.cancel(id)) {
          res.writeHead(204);
          return void res.end();
        }
        return reply(res, 404, NOT_FOUND);
      }
      if (id !== undefined && (req.method === "POST" || req.method === "DELETE")) return reply(res, 404, NOT_FOUND);
      return reply(res, 404, { error: "not_found" });
    } catch (error) {
      // The name only. The session and the address must never reach a log.
      log(`session call failed: ${error instanceof Error ? error.name : "unknown"}`);
      reply(res, 500, { error: "session_failed" });
    }
  }

  return createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (req.method === "GET" && path === "/health") return reply(res, 200, { status: "ok" });
    // Nothing else is answered, not even "no such page", until the caller has shown the token.
    if (!authorised(req.headers.authorization)) return reply(res, 401, { error: "unauthorised" });
    const session = sessions ? SESSION_PATH.exec(path) : null;
    if (sessions && session) return handleSession(sessions, req, res, session[1], session[2] === "/finish");
    if (req.method === "POST" && path === "/login" && login) {
      const text = await readBody(req, maxBodyBytes);
      if (text === null) return reply(res, 413, { error: "too_large" }, { connection: "close" });
      const request = parseLogin(text);
      if (!request) return reply(res, 400, { error: "invalid_request" });
      try {
        const outcome = await login(request);
        log(`login: ${outcome.result}${outcome.why ? ` (${outcome.why})` : ""}`);
        return reply(res, 200, outcome);
      } catch (error) {
        // The name only. The message could hold the address, and the request holds a password.
        log(`login failed: ${error instanceof Error ? error.name : "unknown"}`);
        return reply(res, 500, { error: "login_failed" });
      }
    }
    const known = path === "/verify" || (path === "/check-page" && checkPage) || (path === "/capture" && capture);
    if (req.method !== "POST" || !known) return reply(res, 404, { error: "not_found" });

    const raw = await readBody(req, maxBodyBytes);
    if (raw === null) return reply(res, 413, { error: "too_large" }, { connection: "close" });
    const request = parse(raw);
    if (!request) return reply(res, 400, { error: "invalid_request" });
    try {
      const answer = path === "/capture" && capture ? await capture(request) : path === "/check-page" && checkPage ? await checkPage(request) : await verify(request);
      // Which rule decided, never the address or the page: this is what tells a real login wall from a false alarm.
      const { result, status, signal } = answer as { result?: string; status?: number | null; signal?: string };
      if (signal) log(`${path.slice(1)}: ${result} (${signal}) http=${status ?? "none"}`);
      reply(res, 200, answer);
    } catch (error) {
      // The name only. A browser error message can contain the address and with it a secret.
      const what = path === "/capture" ? "capture" : path === "/check-page" ? "check-page" : "verify";
      log(`${what} failed: ${error instanceof Error ? error.name : "unknown"}`);
      reply(res, 500, { error: `${what === "check-page" ? "check" : what}_failed` });
    }
  });
}
