import { describe, expect, it, vi } from "vitest";
import { resolveBaseUrl } from "./base-url.js";
import { isShopifyError } from "./errors.js";

describe("resolveBaseUrl", () => {
  it("is https on the store's own address by default", () => {
    expect(resolveBaseUrl("my-store.myshopify.com")).toBe("https://my-store.myshopify.com");
  });

  it("normalises the address before building the URL", () => {
    expect(resolveBaseUrl("  My-Store.MyShopify.com ")).toBe("https://my-store.myshopify.com");
  });

  it("refuses an invalid address and never calls the replacement function", () => {
    const resolver = vi.fn(() => "http://127.0.0.1:9999");
    for (const bad of ["evil.com", "x.myshopify.com.evil.com", "https://x.myshopify.com", ""]) {
      try {
        resolveBaseUrl(bad, resolver);
        expect.unreachable();
      } catch (e) {
        expect(isShopifyError(e) && e.code).toBe("invalid_shop");
      }
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it("hands a replacement function only the checked, lower-case address", () => {
    const resolver = vi.fn(() => "http://127.0.0.1:9999");
    expect(resolveBaseUrl("My-Store.myshopify.com", resolver)).toBe("http://127.0.0.1:9999");
    expect(resolver).toHaveBeenCalledWith("my-store.myshopify.com");
  });

  it("drops a trailing slash from the replacement URL", () => {
    expect(resolveBaseUrl("a.myshopify.com", () => "http://127.0.0.1:1/")).toBe("http://127.0.0.1:1");
  });

  it("refuses a replacement that is not an http or https URL", () => {
    expect(() => resolveBaseUrl("a.myshopify.com", () => "file:///etc/passwd")).toThrow();
    expect(() => resolveBaseUrl("a.myshopify.com", () => "not a url")).toThrow();
  });
});
