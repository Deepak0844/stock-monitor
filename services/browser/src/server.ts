import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isSessionState } from "@stock-monitor/supplier-session";
import type { VerifyOutcome, VerifyRequest } from "./verify.js";

export type VerifyFn = (request: VerifyRequest) => Promise<VerifyOutcome>;
export type ControlServerOptions = {
  /** Every call except /health must carry this as a Bearer token. */
  token: string;
  verify: VerifyFn;
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

function parse(raw: string): VerifyRequest | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { url, loginUrl, state } = body as Record<string, unknown>;
  if (!isWebUrl(url) || !isSessionState(state)) return null;
  if (loginUrl !== undefined && (typeof loginUrl !== "string" || loginUrl.length > MAX_URL)) return null;
  return loginUrl === undefined ? { url, state } : { url, loginUrl, state };
}

/** The service's only door. Plain HTTP on the private network: the caller proves itself with the control token. */
export function createControlServer({ token, verify, log = () => {}, maxBodyBytes = 5_000_000 }: ControlServerOptions): Server {
  const tokenDigest = digest(token);
  const authorised = (header: string | undefined) => {
    const given = /^Bearer (.+)$/.exec(header ?? "")?.[1];
    return given !== undefined && timingSafeEqual(digest(given), tokenDigest);
  };
  const reply = (res: ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...extra });
    res.end(JSON.stringify(payload));
  };

  return createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/health") return reply(res, 200, { status: "ok" });
    // Nothing else is answered, not even "no such page", until the caller has shown the token.
    if (!authorised(req.headers.authorization)) return reply(res, 401, { error: "unauthorised" });
    if (req.method !== "POST" || path !== "/verify") return reply(res, 404, { error: "not_found" });

    const raw = await readBody(req, maxBodyBytes);
    if (raw === null) return reply(res, 413, { error: "too_large" }, { connection: "close" });
    const request = parse(raw);
    if (!request) return reply(res, 400, { error: "invalid_request" });
    try {
      reply(res, 200, await verify(request));
    } catch (error) {
      // The name only. A browser error message can contain the address and with it a secret.
      log(`verify failed: ${error instanceof Error ? error.name : "unknown"}`);
      reply(res, 500, { error: "verify_failed" });
    }
  });
}
