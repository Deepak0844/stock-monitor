import type { SessionState } from "./seal.js";

export type CookieImport = { ok: true; state: SessionState; kept: number; dropped: number } | { ok: false; message: string };

export const MAX_IMPORT_COOKIES = 100;

const WRONG_FORMAT = "That is not a cookie export. Export the site's cookies as JSON with a cookie extension (such as Cookie-Editor) and paste the whole text.";
const HEADER_FORMAT = "That looks like a Cookie header, not an export. Export the site's cookies as JSON with a cookie extension (such as Cookie-Editor) and paste the whole text.";
const NOTHING_LEFT = "No usable cookies were found for this supplier's site. The cookies may be for another site, or may have expired. Log in again in your browser, then export again.";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bare = (host: string) => host.trim().toLowerCase().replace(/^\./, "");

/** The cookie's site is the supplier's site, one of its subdomains, or a parent that is a real site (has a dot in it). */
function belongsTo(domain: string, hosts: string[]): boolean {
  return hosts.some((h) => domain === h || domain.endsWith(`.${h}`) || (domain.includes(".") && h.endsWith(`.${domain}`)));
}

const hostOfOrigin = (origin: unknown): string | null => {
  try {
    return typeof origin === "string" ? new URL(origin).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

type Cookie = { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "None" | "Lax" | "Strict" };
const SAME_SITE: Record<string, "None" | "Lax" | "Strict"> = { no_restriction: "None", none: "None", lax: "Lax", strict: "Strict" };

/** Turns one exported cookie into the stored shape, or null when it is not a usable cookie. */
function toCookie(raw: unknown, fallbackHost: string, nowSeconds: number): Cookie | "expired" | null {
  if (!isObject(raw) || typeof raw.name !== "string" || raw.name === "" || typeof raw.value !== "string") return null;
  const domain = typeof raw.domain === "string" && raw.domain.trim() ? bare(raw.domain) : fallbackHost;
  const given = raw.expires ?? raw.expirationDate;
  const expires = raw.session === true || typeof given !== "number" ? -1 : Math.floor(given);
  if (expires !== -1 && expires <= nowSeconds) return "expired";
  const sameSite = SAME_SITE[typeof raw.sameSite === "string" ? raw.sameSite.toLowerCase() : ""] ?? "Lax";
  return {
    name: raw.name,
    value: raw.value,
    domain,
    path: typeof raw.path === "string" && raw.path ? raw.path : "/",
    expires,
    httpOnly: raw.httpOnly === true,
    secure: raw.secure === true || sameSite === "None" || raw.name.startsWith("__Host-") || raw.name.startsWith("__Secure-"),
    sameSite,
  };
}

/**
 * Reads pasted text from a cookie-export extension (an array of cookies) or a Playwright storage state, and keeps what
 * belongs to the supplier's own site. Error messages never contain cookie names or values.
 */
export function parseCookieExport(text: string, siteHosts: string[], nowSeconds: number): CookieImport {
  const hosts = siteHosts.map(bare);
  const input = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
  if (!input.startsWith("[") && !input.startsWith("{")) return { ok: false, message: /^[^\s=]+=/.test(input) ? HEADER_FORMAT : WRONG_FORMAT };
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return { ok: false, message: WRONG_FORMAT };
  }
  const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.cookies) ? data.cookies : null;
  if (!list || list.length === 0) return { ok: false, message: WRONG_FORMAT };

  const cookies: Cookie[] = [];
  for (const raw of list) {
    const cookie = toCookie(raw, hosts[0] ?? "", nowSeconds);
    if (cookie && cookie !== "expired" && belongsTo(cookie.domain, hosts) && cookies.length < MAX_IMPORT_COOKIES) cookies.push(cookie);
  }
  if (cookies.length === 0) return { ok: false, message: NOTHING_LEFT };

  const origins = isObject(data) && Array.isArray(data.origins) ? data.origins.filter((o) => isObject(o) && belongsTo(hostOfOrigin(o.origin) ?? "", hosts)) : [];
  return { ok: true, state: { cookies, origins: origins as SessionState["origins"] }, kept: cookies.length, dropped: list.length - cookies.length };
}
