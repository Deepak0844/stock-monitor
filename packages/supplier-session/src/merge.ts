import type { SessionState } from "./seal.js";

type Cookie = Record<string, unknown>;
const keyOf = (c: Cookie) => `${String(c.domain)}\t${String(c.path)}\t${String(c.name)}`;
const expired = (c: Cookie, nowSeconds: number) => typeof c.expires === "number" && c.expires !== -1 && c.expires <= nowSeconds;

/**
 * The saved session with the cookies a logged-in check came back with. A fresh cookie replaces the saved one with the same
 * name, domain and path. A saved cookie the check left out is kept unless it has expired: a cookie file can leave out
 * session-only cookies, and dropping them would log the supplier out.
 */
export function mergeSessionState(saved: SessionState, fresh: SessionState, nowSeconds: number): SessionState {
  const cookies = new Map<string, Cookie>();
  for (const c of saved.cookies) if (!expired(c, nowSeconds)) cookies.set(keyOf(c), c);
  for (const c of fresh.cookies) if (!expired(c, nowSeconds)) cookies.set(keyOf(c), c);
  return { cookies: [...cookies.values()], origins: fresh.origins.length > 0 ? fresh.origins : saved.origins };
}

const canonical = (s: SessionState) => JSON.stringify({ cookies: [...s.cookies].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1)), origins: s.origins });

/** True when two sessions hold the same cookies (in any order) and the same storage. */
export const sameSessionState = (a: SessionState, b: SessionState): boolean => canonical(a) === canonical(b);
