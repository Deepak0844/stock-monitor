import { isSessionState, type LoginSelectors, type PageClass, type SessionState } from "@stock-monitor/supplier-session";

/** Mirrors the browser service's login types: this package does not depend on the service. */
export type LoginResult = "ok" | "captcha" | "code_required" | "wrong_password" | "account_locked" | "blocked" | "form_not_found" | "unreachable" | "unknown";
export type LoginRequest = {
  loginUrl: string;
  checkUrl: string;
  username: string;
  password: string;
  account?: string;
  stealth: boolean;
  selectors?: LoginSelectors;
  /** Text that only shows when logged in. Set, a page without it is not logged in. */
  loggedInMarker?: string;
  /** The caller can read emailed codes: at a code box the login answers code_needed and waits for sendCode. */
  codeWanted?: true;
};
/** `state` is the signed-in session, present only when the result is ok. `code_needed` comes with the hold to send the code to. */
export type LoginOutcome = { result: LoginResult; state?: SessionState } | { result: "code_needed"; holdId: string };
/** `not_supported`: the service has no login (it is not in profile mode). */
export type LoginCallOutcome = { ok: true; outcome: LoginOutcome } | { ok: false; reason: "unavailable" | "failed" | "not_supported" };

/** Mirrors the browser service's login page check. The service never types or sends anything for it. */
export type InspectControl = { label: string; selector: string };
export type LoginInspection = {
  state: "form" | "opener" | "none" | "captcha" | "unreachable";
  /** The opener was clicked to show the form. */
  opened: boolean;
  found: Record<"open" | "account" | "username" | "password" | "submit", InspectControl | null>;
  fields: InspectControl[];
  buttons: InspectControl[];
};
export type InspectCallOutcome = { ok: true; inspection: LoginInspection } | { ok: false; reason: "unavailable" | "failed" | "not_supported" };

export type OpenOutcome =
  | { ok: true; id: string; expiresAt: string; vncPassword?: string }
  | { ok: false; reason: "busy" | "failed" | "unavailable" };
export type FinishOutcome = { ok: true; state: SessionState } | { ok: false; reason: "not_found" | "failed" | "unavailable" };
/**
 * What a check of a saved session found. It says what the page was, never anything the page held. After an ok page, `state` is
 * the session the browser ended with, for the worker to keep.
 */
export type VerifyOutcome =
  | { ok: true; result: PageClass; status: number | null; blockedRequests: number; state?: SessionState }
  | { ok: false; reason: "failed" | "unavailable" };
/** What a link check saw: the page's address (no query string), title and first heading, never its text. */
export type CheckPageOutcome =
  | { ok: true; result: PageClass; status: number | null; finalUrl: string | null; title: string | null; heading: string | null; softNotFound: boolean; blockedRequests: number; state?: SessionState }
  | { ok: false; reason: "failed" | "unavailable" };
/** A page as the browser showed it: headings with their lines, and the buttons. The picture is for the owner's eyes only. */
/** One offer from the page's built-in product data (schema.org): only these four facts. */
export type PageOffer = { availability: string; url: string | null; sku: string | null; name: string | null };
export type PageDescriptionParts = { sections: { heading: string | null; level: number; lines: string[] }[]; buttons: { label: string; enabled: boolean; section: string | null }[]; offers: PageOffer[] };
export type CaptureOutcome =
  | ({ ok: true; picture: Buffer | null; description: PageDescriptionParts } & Omit<Extract<CheckPageOutcome, { ok: true }>, "ok">)
  | { ok: false; reason: "failed" | "unavailable" };
/** What a quick read (a plain download, no browser) found: what the page was and its built-in offers. Never its HTML. */
export type QuickReadOutcome =
  | { ok: true; result: PageClass; status: number | null; finalUrl: string | null; softNotFound: boolean; offers: PageOffer[]; blockedRequests: number }
  | { ok: false; reason: "failed" | "unavailable" };
export type CancelOutcome = { ok: true } | { ok: false; reason: "not_found" | "unavailable" };

export type BrowserClient = {
  /** Opens a login window at the address. */
  /** `stealth` gives the window the disguise (a real graphics card, Google Chrome's name). Only the plain window has it. */
  openSession(url: string, options?: { stealth?: boolean }): Promise<OpenOutcome>;
  /** Saves the login as it is now and closes the window. */
  finishSession(id: string): Promise<FinishOutcome>;
  cancelSession(id: string): Promise<CancelOutcome>;
  /** Loads one page with a saved session and says what happened to it: the status, where it ended, its title and heading. */
  /** `publicPage`: the supplier needs no login, so login wording on its page is not a login wall. */
  checkPage(request: { url: string; loginUrl?: string; loggedInMarker?: string; state: SessionState; stealth?: boolean; publicPage?: boolean }): Promise<CheckPageOutcome>;
  /** Loads one page with a saved session and describes it, for stock rules. A picture is taken only when asked for. */
  capture(request: { url: string; loginUrl?: string; loggedInMarker?: string; state: SessionState; picture?: boolean; stealth?: boolean; publicPage?: boolean }): Promise<CaptureOutcome>;
  /** Downloads a public page without the browser and reads its offers. An older service without the route says failed. */
  quickRead(request: { url: string }): Promise<QuickReadOutcome>;
  /** Signs in with a username and password, once, in the supplier's profile. The password goes in the request only, never in an answer or an error. */
  login(request: LoginRequest): Promise<LoginCallOutcome>;
  /** Looks at a supplier's login page and says what a login would use there, and what else could be picked. Nothing is typed or sent. */
  inspectLogin(request: { loginUrl: string; checkUrl: string; stealth: boolean; selectors?: LoginSelectors }): Promise<InspectCallOutcome>;
  /** Sends the emailed code to a login waiting at a code box, and answers how that login ended. */
  sendCode(holdId: string, code: string): Promise<LoginCallOutcome>;
  /** Ends a login waiting at a code box with no code. Never throws. */
  cancelCode(holdId: string): Promise<void>;
  /** Loads a page with a saved session in a throw-away browser and says what it was. */
  verify(request: { url: string; loginUrl?: string; loggedInMarker?: string; state: SessionState; stealth?: boolean }): Promise<VerifyOutcome>;
};

export type BrowserClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  /** How long to wait for a page check or capture. The service loads pages one at a time, each in a fresh browser, so one can wait behind another. */
  pageTimeoutMs?: number;
  /** How long to wait for a login: the service types slowly, waits for a second step and lets the page settle. */
  loginTimeoutMs?: number;
  /** How long to wait for a login to finish after its emailed code is sent: type, submit, confirm. */
  codeTimeoutMs?: number;
  /** How long to wait for a login page check: it loads the page, may open it once, and lists what is there. */
  inspectTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const PAGE_CLASSES: readonly string[] = ["ok", "login_required", "captcha", "blocked", "unreachable", "unknown"];
const LOGIN_RESULTS: readonly string[] = ["ok", "captcha", "code_required", "wrong_password", "account_locked", "blocked", "form_not_found", "unreachable", "unknown"];
const INSPECT_STATES: readonly string[] = ["form", "opener", "none", "captcha", "unreachable"];
const INSPECT_ROLES = ["open", "account", "username", "password", "submit"] as const;
const MAX_CONTROLS = 40;
const isControl = (v: unknown): v is InspectControl => isObject(v) && typeof v.label === "string" && typeof v.selector === "string";
const isControlList = (v: unknown): v is InspectControl[] => Array.isArray(v) && v.length <= MAX_CONTROLS && v.every(isControl);
const isInspection = (v: unknown): v is LoginInspection =>
  isObject(v) && INSPECT_STATES.includes(v.state as string) && typeof v.opened === "boolean" && isObject(v.found) && INSPECT_ROLES.every((r) => (v.found as Record<string, unknown>)[r] === null || isControl((v.found as Record<string, unknown>)[r])) && isControlList(v.fields) && isControlList(v.buttons);
const WINDOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Talks to the browser service over the private network. It never throws and never puts a token, an
 * address or a session in a message: every problem becomes a short reason the caller turns into plain words.
 */
export function createBrowserClient({ baseUrl, token, timeoutMs = 30_000, pageTimeoutMs = 120_000, loginTimeoutMs = 240_000, codeTimeoutMs = 150_000, inspectTimeoutMs = 90_000, fetchImpl = fetch }: BrowserClientOptions): BrowserClient {
  const root = baseUrl.replace(/\/+$/, "");

  /** A finished login's answer: the result, and the session when it is ok. */
  const loginAnswer = (r: { status: number; json: unknown }): LoginCallOutcome => {
    const j = r.json;
    if (r.status !== 200 || !isObject(j) || typeof j.result !== "string" || !LOGIN_RESULTS.includes(j.result)) return { ok: false, reason: "failed" };
    const result = j.result as LoginResult;
    return { ok: true, outcome: { result, ...(result === "ok" && isSessionState(j.state) ? { state: j.state } : {}) } };
  };

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
    async openSession(url, { stealth } = {}) {
      const r = await call("POST", "/sessions", { url, ...(stealth ? { stealth: true } : {}) });
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

    async verify({ url, loginUrl, loggedInMarker, state, stealth }) {
      const r = await call("POST", "/verify", { url, ...(loginUrl ? { loginUrl } : {}), ...(loggedInMarker ? { loggedInMarker } : {}), state, ...(stealth ? { stealth: true } : {}) });
      if (!r) return { ok: false, reason: "unavailable" };
      const j = r.json;
      if (r.status !== 200 || !isObject(j) || typeof j.result !== "string" || !PAGE_CLASSES.includes(j.result)) return { ok: false, reason: "failed" };
      return {
        ok: true,
        result: j.result as PageClass,
        status: typeof j.status === "number" ? j.status : null,
        blockedRequests: typeof j.blockedRequests === "number" ? j.blockedRequests : 0,
        ...(isSessionState(j.state) ? { state: j.state } : {}),
      };
    },

    async login(request) {
      const r = await call("POST", "/login", request, loginTimeoutMs);
      if (!r) return { ok: false, reason: "unavailable" };
      if (r.status === 404) return { ok: false, reason: "not_supported" };
      if (r.status === 200 && isObject(r.json) && r.json.result === "code_needed") {
        return typeof r.json.holdId === "string" ? { ok: true, outcome: { result: "code_needed", holdId: r.json.holdId } } : { ok: false, reason: "failed" };
      }
      return loginAnswer(r);
    },

    async inspectLogin(request) {
      const r = await call("POST", "/login/inspect", request, inspectTimeoutMs);
      if (!r) return { ok: false, reason: "unavailable" };
      if (r.status === 404) return { ok: false, reason: "not_supported" };
      return r.status === 200 && isInspection(r.json) ? { ok: true, inspection: r.json } : { ok: false, reason: "failed" };
    },

    async sendCode(holdId, code) {
      const r = await call("POST", `/login/${encodeURIComponent(holdId)}/code`, { code }, codeTimeoutMs);
      if (!r) return { ok: false, reason: "unavailable" };
      return loginAnswer(r);
    },

    async cancelCode(holdId) {
      await call("POST", `/login/${encodeURIComponent(holdId)}/cancel`).catch(() => null);
    },

    async checkPage({ url, loginUrl, loggedInMarker, state, stealth, publicPage }) {
      const r = await call("POST", "/check-page", { url, ...(loginUrl ? { loginUrl } : {}), ...(loggedInMarker ? { loggedInMarker } : {}), state, ...(stealth ? { stealth: true } : {}), ...(publicPage ? { publicPage: true } : {}) }, pageTimeoutMs);
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
        ...(isSessionState(j.state) ? { state: j.state } : {}),
      };
    },

    async quickRead({ url }) {
      const r = await call("POST", "/quick-read", { url, publicPage: true }, pageTimeoutMs);
      if (!r) return { ok: false, reason: "unavailable" };
      const j = r.json;
      if (r.status !== 200 || !isObject(j) || typeof j.result !== "string" || !PAGE_CLASSES.includes(j.result) || !Array.isArray(j.offers)) return { ok: false, reason: "failed" };
      const text = (v: unknown) => (typeof v === "string" ? v : null);
      return {
        ok: true,
        result: j.result as PageClass,
        status: typeof j.status === "number" ? j.status : null,
        finalUrl: text(j.finalUrl),
        softNotFound: j.softNotFound === true,
        offers: (j.offers as unknown[]).filter((o): o is Record<string, unknown> => isObject(o) && typeof o.availability === "string").map((o) => ({ availability: o.availability as string, url: text(o.url), sku: text(o.sku), name: text(o.name) })),
        blockedRequests: j.blocked === true ? 1 : 0,
      };
    },

    async capture({ url, loginUrl, loggedInMarker, state, picture, stealth, publicPage }) {
      const r = await call("POST", "/capture", { url, ...(loginUrl ? { loginUrl } : {}), ...(loggedInMarker ? { loggedInMarker } : {}), state, ...(picture ? { picture: true } : {}), ...(stealth ? { stealth: true } : {}), ...(publicPage ? { publicPage: true } : {}) }, pageTimeoutMs);
      if (!r) return { ok: false, reason: "unavailable" };
      const j = r.json;
      if (r.status !== 200 || !isObject(j) || typeof j.result !== "string" || !PAGE_CLASSES.includes(j.result) || !isObject(j.description)) return { ok: false, reason: "failed" };
      const d = j.description;
      if (!Array.isArray(d.sections) || !Array.isArray(d.buttons) || (d.offers !== undefined && !Array.isArray(d.offers))) return { ok: false, reason: "failed" };
      const text = (v: unknown) => (typeof v === "string" ? v : null);
      // Only well-formed offers are kept; an older service sends none.
      const offers: PageOffer[] = ((d.offers as unknown[] | undefined) ?? [])
        .filter((o): o is Record<string, unknown> => isObject(o) && typeof o.availability === "string")
        .map((o) => ({ availability: o.availability as string, url: text(o.url), sku: text(o.sku), name: text(o.name) }));
      return {
        ok: true,
        result: j.result as PageClass,
        status: typeof j.status === "number" ? j.status : null,
        finalUrl: text(j.finalUrl),
        title: text(j.title),
        heading: text(j.heading),
        softNotFound: j.softNotFound === true,
        blockedRequests: typeof j.blockedRequests === "number" ? j.blockedRequests : 0,
        ...(isSessionState(j.state) ? { state: j.state } : {}),
        description: { sections: d.sections as PageDescriptionParts["sections"], buttons: d.buttons as PageDescriptionParts["buttons"], offers },
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
