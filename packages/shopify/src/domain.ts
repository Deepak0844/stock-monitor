export type ShopDomainResult = { ok: true; domain: string } | { ok: false; message: string };

// One store name of 1 to 63 letters, digits or hyphens (not at the ends), then exactly ".myshopify.com".
// ASCII only, no flags that fold other characters. Checked on the original text, then lower-cased.
const SHOP_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/i;
const MAX_INPUT = 300;

const MESSAGE = "Enter your store address, like my-store.myshopify.com.";

/**
 * The only way a store address gets into the app. Credentials are sent to the address this returns,
 * so anything that is not a plain store name under myshopify.com is refused.
 */
export function validateShopDomain(input: unknown): ShopDomainResult {
  if (typeof input !== "string" || input.length > MAX_INPUT) return { ok: false, message: MESSAGE };
  const value = input.trim();
  if (!SHOP_DOMAIN.test(value)) return { ok: false, message: MESSAGE };
  return { ok: true, domain: value.toLowerCase() };
}
