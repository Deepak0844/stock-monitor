import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Whether a change message really came from Shopify: Shopify signs the exact body with the app's client secret
 * and sends the base64 HMAC-SHA256 in X-Shopify-Hmac-Sha256. A missing or malformed header is false, never a throw.
 */
export function verifyShopifyHmac(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(header, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
