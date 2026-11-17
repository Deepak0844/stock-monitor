import { decrypt, encrypt, type Encrypted } from "@stock-monitor/crypto";

/** A supplier login. `account` is for sites that ask for an account number as well. */
export type Credentials = { username: string; password: string; account?: string };

/** Page elements the automatic login clicks or fills. Each is a CSS selector. */
export type LoginSelectors = { open?: string; account?: string; username?: string; password?: string; submit?: string };

const MAX = 200;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= MAX;
const onlyKeys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));

/** True for a username and password, plus an optional account number, and nothing else. */
export const isCredentials = (v: unknown): v is Credentials =>
  isObject(v) && onlyKeys(v, ["username", "password", "account"]) && isText(v.username) && isText(v.password) && (v.account === undefined || isText(v.account));

/** True for an object holding only the known selector keys, each a short non-empty string. */
export const isLoginSelectors = (v: unknown): v is LoginSelectors =>
  isObject(v) && onlyKeys(v, ["open", "account", "username", "password", "submit"]) && Object.values(v).every(isText);

/** Encrypts supplier credentials. Only the sealed form is ever stored. */
export function sealCredentials(c: Credentials, key: Buffer, keyId: string): Encrypted {
  if (!isCredentials(c)) throw new Error("Those are not valid credentials.");
  return encrypt(JSON.stringify(c), key, keyId);
}

/** Decrypts supplier credentials. A wrong key, changed data or unexpected content all give the same plain error. */
export function unsealCredentials(sealed: Encrypted, key: Buffer): Credentials {
  const unreadable = new Error("The saved credentials could not be read.");
  let c: unknown;
  try {
    c = JSON.parse(decrypt(sealed, key));
  } catch {
    throw unreadable;
  }
  if (!isCredentials(c)) throw unreadable;
  return c;
}
