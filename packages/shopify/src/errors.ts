export type ShopifyErrorCode =
  | "rejected_credentials"
  | "no_access"
  | "throttled"
  | "unreachable"
  | "unexpected_reply"
  | "invalid_shop"
  | "wrong_organization"
  | "store_unavailable";

// Written for the store owner. No technical words, and never any text that came from Shopify.
const MESSAGES: Record<ShopifyErrorCode, string> = {
  rejected_credentials: "Shopify rejected the saved connection. Reconnect Shopify.",
  no_access: "This connection does not have permission to read that from Shopify. Check the app's permissions in Shopify.",
  throttled: "Shopify is asking us to slow down. Try again in a few minutes.",
  unreachable: "Can't reach Shopify right now. Try again in a few minutes.",
  unexpected_reply: "Shopify sent a reply we did not expect. Try again later.",
  invalid_shop: "Enter your store address, like my-store.myshopify.com.",
  wrong_organization:
    "Shopify says this app and your store belong to different organisations. Create the app in the same organisation as your store.",
  store_unavailable:
    "Shopify says your store is not available right now. It may be frozen or locked. Check your Shopify account.",
};

export class ShopifyError extends Error {
  readonly code: ShopifyErrorCode;
  /** For developers and tests only. Not in the message, not serialised, not logged by default. */
  declare readonly detail?: string;

  constructor(code: ShopifyErrorCode, options?: { detail?: string }) {
    super(MESSAGES[code]);
    this.name = "ShopifyError";
    this.code = code;
    if (options?.detail !== undefined) {
      Object.defineProperty(this, "detail", { value: options.detail, enumerable: false });
    }
  }
}

export const isShopifyError = (error: unknown): error is ShopifyError => error instanceof ShopifyError;
