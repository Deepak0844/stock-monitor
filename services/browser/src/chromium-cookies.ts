import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** A cookie in the shape the rest of the app stores (the same as Playwright's). */
export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Seconds since 1970, or -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

// On Linux, with Chromium's simplest password store (`--password-store=basic`), cookie values are AES-128-CBC encrypted
// with a fixed, well-known key. It keeps the file from being read at a glance. It is not a secret, so this file never
// treats the profile as one: the profile lives in memory and is deleted when the window ends.
const KEY = pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
const IV = Buffer.alloc(16, 0x20);
const WINDOWS_EPOCH_SECONDS = 11_644_473_600n; // Chromium counts from 1601
const SAME_SITE = ["None", "Lax", "Strict"] as const; // Chromium stores 0, 1 and 2, and -1 for "not said"

/** Reads one cookie value as Chromium wrote it. Throws if it is damaged or uses a scheme this does not support. */
export function decryptCookieValue(stored: Buffer, hostKey: string): string {
  if (stored.length === 0) return "";
  const scheme = stored.subarray(0, 3).toString("latin1");
  if (scheme === "v11") throw new Error("This cookie encryption is not supported.");
  if (scheme !== "v10") return stored.toString("utf8"); // not encrypted
  const decipher = createDecipheriv("aes-128-cbc", KEY, IV);
  const plain = Buffer.concat([decipher.update(stored.subarray(3)), decipher.final()]);
  // Newer Chromium puts a fingerprint of the cookie's domain in front of the value.
  const fingerprint = createHash("sha256").update(hostKey).digest();
  return (
    plain.length >= 32 && plain.subarray(0, 32).equals(fingerprint) ? plain.subarray(32) : plain
  ).toString("utf8");
}

type Row = {
  host_key: string;
  name: string;
  value: string | null;
  encrypted_value: Uint8Array | null;
  path: string;
  expires_utc: bigint | number;
  has_expires: bigint | number;
  is_secure: bigint | number;
  is_httponly: bigint | number;
  samesite: bigint | number;
};

/** The cookies in a profile's cookie store. Read only: the file is never changed. */
export function readCookies(file: string): StoredCookie[] {
  if (!existsSync(file)) throw new Error("There is no cookie store to read.");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const statement = db.prepare(
      "select host_key, name, value, encrypted_value, path, expires_utc, has_expires, is_secure, is_httponly, samesite from cookies",
    );
    statement.setReadBigInts(true);
    const rows = statement.all() as unknown as Row[];
    const cookies: StoredCookie[] = [];
    let unreadable = 0;
    for (const row of rows) {
      try {
        const encrypted = row.encrypted_value ? Buffer.from(row.encrypted_value) : Buffer.alloc(0);
        const value =
          encrypted.length > 0 ? decryptCookieValue(encrypted, row.host_key) : (row.value ?? "");
        const expiresUtc = BigInt(
          typeof row.expires_utc === "bigint"
            ? row.expires_utc
            : Math.trunc(Number(row.expires_utc)),
        );
        cookies.push({
          name: row.name,
          value,
          domain: row.host_key,
          path: row.path || "/",
          expires:
            Number(row.has_expires) === 0 || expiresUtc === 0n
              ? -1
              : Number(expiresUtc / 1_000_000n - WINDOWS_EPOCH_SECONDS),
          httpOnly: Number(row.is_httponly) !== 0,
          secure: Number(row.is_secure) !== 0,
          sameSite: SAME_SITE[Number(row.samesite)] ?? "Lax",
        });
      } catch {
        unreadable += 1;
      }
    }
    if (rows.length > 0 && cookies.length === 0 && unreadable > 0)
      throw new Error("The saved cookies could not be read.");
    return cookies;
  } finally {
    db.close();
  }
}
