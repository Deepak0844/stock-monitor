import { describe, expect, it } from "vitest";
import { ShopifyError, isShopifyError, type ShopifyErrorCode } from "./errors.js";

const codes: ShopifyErrorCode[] = [
  "rejected_credentials",
  "no_access",
  "throttled",
  "unreachable",
  "unexpected_reply",
  "invalid_shop",
  "wrong_organization",
  "store_unavailable",
];

describe("ShopifyError", () => {
  it.each(codes)("%s carries its code and is recognised as a Shopify error", (code) => {
    const error = new ShopifyError(code);
    expect(error.code).toBe(code);
    expect(error).toBeInstanceOf(Error);
    expect(isShopifyError(error)).toBe(true);
  });

  it("is not confused with other errors", () => {
    expect(isShopifyError(new Error("x"))).toBe(false);
    expect(isShopifyError({ code: "throttled" })).toBe(false);
    expect(isShopifyError(null)).toBe(false);
  });

  it("gives each error its own message", () => {
    const messages = codes.map((c) => new ShopifyError(c).message);
    expect(new Set(messages).size).toBe(codes.length);
  });

  it.each(codes)("%s has a message written for the store owner, with no technical words", (code) => {
    const { message } = new ShopifyError(code);
    expect(message).toMatch(/^[A-Z].*\.$/);
    expect(message).not.toMatch(/graphql|http|\b4\d\d\b|\b5\d\d\b|token|secret|api|json|exception|stack/i);
  });

  it("tells the owner to reconnect when Shopify rejects the credentials", () => {
    expect(new ShopifyError("rejected_credentials").message).toBe(
      "Shopify rejected the saved connection. Reconnect Shopify.",
    );
  });

  it("explains the different-organization problem in plain words", () => {
    expect(new ShopifyError("wrong_organization").message).toBe(
      "Shopify says this app and your store belong to different organizations. Create the app in the same organization as your store.",
    );
  });

  it("says when the store itself is unavailable", () => {
    expect(new ShopifyError("store_unavailable").message).toBe(
      "Shopify says your store is not available right now. It may be frozen or locked. Check your Shopify account.",
    );
  });

  it("asks for a store address when the address is not valid", () => {
    expect(new ShopifyError("invalid_shop").message).toBe(
      "Enter your store address, like my-store.myshopify.com.",
    );
  });

  it("says to try again later when Shopify cannot be reached or is busy", () => {
    expect(new ShopifyError("unreachable").message).toBe(
      "Can't reach Shopify right now. Try again in a few minutes.",
    );
    expect(new ShopifyError("throttled").message).toMatch(/try again in a few minutes/i);
  });

  it("keeps internal detail out of the message and out of the serialised form", () => {
    const marker = "UPSTREAM-DETAIL-MARKER";
    const error = new ShopifyError("unreachable", { detail: `connect ECONNREFUSED ${marker}` });
    expect(error.message).not.toContain(marker);
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(String(error)).not.toContain(marker);
  });

  it("keeps the detail available for developers only, outside the message", () => {
    const error = new ShopifyError("unexpected_reply", { detail: "missing field data.shop" });
    expect(error.detail).toBe("missing field data.shop");
  });
});
