import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const HEX_64 = /^[0-9a-f]{64}$/;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** A new one-time token: 256 random bits as 64 hex characters. Only `hash` is ever stored. */
export function createLoginToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

/** Whether `token` is the one `hash` was made from. Compares in constant time, and says no, never throws, for anything malformed. */
export function tokenMatchesHash(token: unknown, hash: string): boolean {
  if (typeof token !== "string" || !HEX_64.test(token) || !HEX_64.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(hash, "hex"));
}
