import { decrypt, encrypt, type Encrypted } from "@stock-monitor/crypto";

/** What Playwright's storageState() returns: cookies and local storage. Kept loose, because we only store it. */
export type SessionState = { cookies: Record<string, unknown>[]; origins: Record<string, unknown>[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isSessionState = (v: unknown): v is SessionState => isObject(v) && Array.isArray(v.cookies) && Array.isArray(v.origins);

/** Encrypts a saved login session. Only the sealed form is ever stored. */
export function sealSessionState(state: unknown, key: Buffer, keyId: string): Encrypted {
  if (!isSessionState(state)) throw new Error("That is not a saved session.");
  return encrypt(JSON.stringify(state), key, keyId);
}

/** Decrypts a saved login session. A wrong key, changed data or unexpected content all give the same plain error. */
export function unsealSessionState(sealed: Encrypted, key: Buffer): SessionState {
  const unreadable = new Error("The saved session could not be read.");
  let state: unknown;
  try {
    state = JSON.parse(decrypt(sealed, key));
  } catch {
    throw unreadable;
  }
  if (!isSessionState(state)) throw unreadable;
  return state;
}
