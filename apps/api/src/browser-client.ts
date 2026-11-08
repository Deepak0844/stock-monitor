import { isSessionState, type SessionState } from "@stock-monitor/supplier-session";

export type OpenOutcome =
  | { ok: true; id: string; expiresAt: string; vncPassword?: string }
  | { ok: false; reason: "busy" | "failed" | "unavailable" };
export type FinishOutcome = { ok: true; state: SessionState } | { ok: false; reason: "not_found" | "failed" | "unavailable" };
export type CancelOutcome = { ok: true } | { ok: false; reason: "not_found" | "unavailable" };

export type BrowserClient = {
  /** Opens a login window at the address. */
  openSession(url: string): Promise<OpenOutcome>;
  /** Saves the login as it is now and closes the window. */
  finishSession(id: string): Promise<FinishOutcome>;
  cancelSession(id: string): Promise<CancelOutcome>;
};

export type BrowserClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const WINDOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Talks to the browser service over the private network. It never throws and never puts a token, an
 * address or a session in a message: every problem becomes a short reason the caller turns into plain words.
 */
export function createBrowserClient({ baseUrl, token, timeoutMs = 30_000, fetchImpl = fetch }: BrowserClientOptions): BrowserClient {
  const root = baseUrl.replace(/\/+$/, "");

  /** The status and JSON body, or null when nothing answered in time. */
  async function call(method: string, path: string, body?: unknown, limit = timeoutMs): Promise<{ status: number; json: unknown } | null> {
    try {
      const res = await fetchImpl(`${root}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(limit),
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { status: res.status, json };
    } catch {
      return null;
    }
  }

  return {
    async openSession(url) {
      const r = await call("POST", "/sessions", { url });
      if (!r) return { ok: false, reason: "unavailable" };
      if (r.status === 409) return { ok: false, reason: "busy" };
      const j = r.json;
      if (r.status !== 201 || !isObject(j) || typeof j.id !== "string" || !WINDOW_ID.test(j.id) || typeof j.expiresAt !== "string") {
        return { ok: false, reason: "failed" };
      }
      return { ok: true, id: j.id, expiresAt: j.expiresAt, ...(typeof j.vncPassword === "string" ? { vncPassword: j.vncPassword } : {}) };
    },

    async finishSession(id) {
      if (!WINDOW_ID.test(id)) return { ok: false, reason: "not_found" };
      const r = await call("POST", `/sessions/${id}/finish`);
      if (!r) return { ok: false, reason: "unavailable" };
      if (r.status === 404) return { ok: false, reason: "not_found" };
      if (r.status !== 200 || !isObject(r.json) || !isSessionState(r.json.state)) return { ok: false, reason: "failed" };
      return { ok: true, state: r.json.state };
    },

    async cancelSession(id) {
      if (!WINDOW_ID.test(id)) return { ok: false, reason: "not_found" };
      const r = await call("DELETE", `/sessions/${id}`, undefined, Math.min(timeoutMs, 10_000));
      if (!r) return { ok: false, reason: "unavailable" };
      return r.status === 204 ? { ok: true } : { ok: false, reason: "not_found" };
    },
  };
}
