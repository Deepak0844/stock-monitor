import { validateShopDomain } from "./domain.js";
import { ShopifyError } from "./errors.js";

/** Test-only: lets a fake Shopify server stand in for the store. Never taken from user input. */
export type BaseUrlResolver = (shopDomain: string) => string;

/**
 * The address requests are sent to. The store address is checked first, so a replacement
 * function only ever sees a valid, lower-case *.myshopify.com name.
 */
export function resolveBaseUrl(shop: string, resolver?: BaseUrlResolver): string {
  const checked = validateShopDomain(shop);
  if (!checked.ok) throw new ShopifyError("invalid_shop");

  const raw = resolver ? resolver(checked.domain) : `https://${checked.domain}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The base URL replacement is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The base URL replacement must be http or https.");
  }
  return url.origin;
}
