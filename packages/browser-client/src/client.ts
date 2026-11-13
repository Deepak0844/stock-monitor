import { isSessionState, type PageClass, type SessionState } from "@stock-monitor/supplier-session";

export type OpenOutcome =
  | { ok: true; id: string; expiresAt: string; vncPassword?: string }
  | { ok: false; reason: "busy" | "failed" | "unavailable" };
export type FinishOutcome = { ok: true; state: SessionState } | { ok: false; reason: "not_found" | "failed" | "unavailable" };
/** What a check of a saved session found. It says what the page was, never anything the page held. */
export type VerifyOutcome =
  | { ok: true; result: PageClass; status: number | null; blockedRequests: number }
  | { ok: false; reason: "failed" | "unavailable" };
/** What a link check saw: the page's address (no query string), title and first heading, never its text. */
export type CheckPageOutcome =
  | { ok: true; result: PageClass; status: number | null; finalUrl: string | null; title: string | null; heading: string | null; softNotFound: boolean; blockedRequests: number }
  | { ok: false; reason: "failed" | "unavailable" };
/** A page as the browser showed it: headings with their lines, and the buttons. The picture is for the owner's eyes only. */
export type PageDescriptionParts = { sections: { heading: string | null; level: number; lines: string[] }[]; buttons: { label: string; enabled: boolean; section: string | null }[] };
export type CaptureOutcome =
  | ({ ok: true; picture: Buffer | null; description: PageDescriptionParts } & Omit<Extract<CheckPageOutcome, { ok: true }>, "ok">)
  | { ok: false; reason: "failed" | "unavailable" };
export type CancelOutcome = { ok: true } | { ok: false; reason: "not_found" | "unavailable" };

export type BrowserClient = {
  /** Opens a login window at the address. */
  openSession(url: string): Promise<OpenOutcome>;
  /** Saves the login as it is now and closes the window. */
  finishSession(id: string): Promise<FinishOutcome>;
  cancelSession(id: string): Promise<CancelOutcome>;
  /** Loads one page with a saved session and says what happened to it: the status, where it ended, its title and heading. */
  checkPage(request: { url: string; loginUrl?: string; state: SessionState }): Promise<CheckPageOutcome>;
  /** Loads one page with a saved session and describes it, for stock rules. A picture is taken only when asked for. */
  capture(request: { url: string; loginUrl?: string; state: SessionState; picture?: boolean }): Promise<CaptureOutcome>;
  /** Loads a page with a saved session in a throw-away browser and says what it was. */
  verify(request: { url: string; loginUrl?: string; state: SessionState }): Promise<VerifyOutcome>;
};

export type BrowserClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  /** How long to wait for a page check or capture. The service loads pages one at a time, each in a fresh browser, so one can wait behind another. */
  pageTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const PAGE_CLASSES: readonly string[] = ["ok", "login_required", "captcha", "blocked", "unreachable", "unknown"];
const WINDOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Talks to the browser service over the private network. It never throws and never puts a token, an
 * address or a session in a message: every problem becomes a short reason the caller turns into plain words.
 */
export function createBrowserClient({ baseUrl, token, timeoutMs = 30_000, pageTimeoutMs = 120_000, fetchImpl = fetch }: BrowserClientOptions): BrowserClient {
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

    async verify({ url, loginUrl, state }) {
      const r = await call("POST", "/verify", { url, ...(loginUrl ? { loginUrl } : {}), state });
      if (!r) return { ok: false, reason: "unavailable" };
      const j = r.json;
      if (r.status !== 200 || !isObject(j) || typeof j.result !== "string" || !PAGE_CLASSES.includes(j.result)) return { ok: false, reason: "failed" };
      return {
        ok: true,
        result: j.result as PageClass,
        status: typeof j.status === "number" ? j.status : null,
        blockedRequests: typeof j.blockedRequests === "number" ? j.blockedRequests : 0,
      };
    },

    async checkPage({ url, loginUrl, state }) {
      const r = await call("POST", "/check-page", { url, ...(loginUrl ? { loginUrl } : {}), state }, pageTimeoutMs);
      if (!r) return { ok: false, reason: "unavailable" };
      const j = r.json;
      if (r.status !== 200 || !isObject(j) || typeof j.result !== "string" || !PAGE_CLASSES.includes(j.result)) return { ok: false, reason: "failed" };
      const text = (v: unknown) => (typeof v === "string" ? v : null);
      return {
        ok: true,
        result: j.result as PageClass,
        status: typeof j.status === "number" ? j.status : null,
        finalUrl: text(j.finalUrl),
        title: text(j.title),
        heading: text(j.heading),
        softNotFound: j.softNotFound === true,
        blockedRequests: typeof j.blockedRequests === "number" ? j.blockedRequests : 0,
      };
    },

    async capture({ url, loginUrl, state, picture }) {
      const r = await call("POST", "/capture", { url, ...(loginUrl ? { loginUrl } : {}), state, ...(picture ? { picture: true } : {}) }, pageTimeoutMs);
      if (!r) return { ok: false, reason: "unavailable" };
      const j = r.json;
      if (r.status !== 200 || !isObject(j) || typeof j.result !== "string" || !PAGE_CLASSES.includes(j.result) || !isObject(j.description)) return { ok: false, reason: "failed" };
      const d = j.description;
      if (!Array.isArray(d.sections) || !Array.isArray(d.buttons)) return { ok: false, reason: "failed" };
      const text = (v: unknown) => (typeof v === "string" ? v : null);
      return {
        ok: true,
        result: j.result as PageClass,
        status: typeof j.status === "number" ? j.status : null,
        finalUrl: text(j.finalUrl),
        title: text(j.title),
        heading: text(j.heading),
        softNotFound: j.softNotFound === true,
        blockedRequests: typeof j.blockedRequests === "number" ? j.blockedRequests : 0,
        description: { sections: d.sections as PageDescriptionParts["sections"], buttons: d.buttons as PageDescriptionParts["buttons"] },
        picture: typeof j.picture === "string" ? Buffer.from(j.picture, "base64") : null,
      };
    },

    async cancelSession(id) {
      if (!WINDOW_ID.test(id)) return { ok: false, reason: "not_found" };
      const r = await call("DELETE", `/sessions/${id}`, undefined, Math.min(timeoutMs, 10_000));
      if (!r) return { ok: false, reason: "unavailable" };
      return r.status === 204 ? { ok: true } : { ok: false, reason: "not_found" };
    },
  };
}
