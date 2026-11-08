import { describe, expect, it } from "vitest";
import { validateShopDomain } from "./domain.js";

const accepted = (input: string) => {
  const r = validateShopDomain(input);
  return r.ok ? r.domain : null;
};

describe("validateShopDomain: accepts real store addresses", () => {
  it.each(["my-store.myshopify.com", "a.myshopify.com", "store123.myshopify.com", "a-b-c.myshopify.com"])(
    "%s",
    (domain) => expect(accepted(domain)).toBe(domain),
  );

  it("ignores spaces around the address and capital letters, and returns it in lower case", () => {
    expect(accepted("  My-Store.MyShopify.com ")).toBe("my-store.myshopify.com");
  });

  it("accepts a 63-character store name, the longest a hostname label can be", () => {
    const label = "a".repeat(63);
    expect(accepted(`${label}.myshopify.com`)).toBe(`${label}.myshopify.com`);
  });
});

describe("validateShopDomain: rejects anything that could send credentials elsewhere", () => {
  it.each([
    ["another host", "evil.com"],
    ["our name as a prefix of another host", "x.myshopify.com.evil.com"],
    ["our name hidden in a subdomain of another host", "myshopify.com.evil.com"],
    ["the bare shopify host", "myshopify.com"],
    ["a nested subdomain", "a.b.myshopify.com"],
    ["a different top-level domain", "x.myshopify.co"],
    ["a look-alike suffix", "x.notmyshopify.com"],
    ["a scheme", "https://x.myshopify.com"],
    ["a path", "x.myshopify.com/admin"],
    ["a query string", "x.myshopify.com?a=1"],
    ["a port", "x.myshopify.com:8080"],
    ["a fragment", "x.myshopify.com#a"],
    ["credentials in the address", "user@x.myshopify.com"],
    ["a backslash", "x.myshopify.com\\evil.com"],
    ["an at sign trick", "evil.com@x.myshopify.com"],
    ["a trailing dot", "x.myshopify.com."],
    ["an empty name", ".myshopify.com"],
    ["a leading hyphen", "-x.myshopify.com"],
    ["a trailing hyphen", "x-.myshopify.com"],
    ["an underscore", "x_y.myshopify.com"],
    ["an IP address", "127.0.0.1"],
    ["localhost", "localhost"],
    ["a space inside", "x y.myshopify.com"],
    ["a newline inside", "x.myshopify.com\nevil.com"],
    ["a null byte", "x.myshopify.com\u0000.evil.com"],
    ["non-ASCII look-alike letters", "ѕtore.myshopify.com"],
    ["a full-width dot", "x．myshopify.com"],
    ["an empty string", ""],
    ["only spaces", "   "],
  ])("%s", (_label, input) => {
    expect(validateShopDomain(input).ok).toBe(false);
  });

  it("rejects a name longer than 63 characters", () => {
    expect(validateShopDomain(`${"a".repeat(64)}.myshopify.com`).ok).toBe(false);
  });

  it("rejects very long input without hanging", () => {
    const start = Date.now();
    expect(validateShopDomain("a".repeat(100_000)).ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("rejects values that are not text", () => {
    expect(validateShopDomain(undefined as unknown as string).ok).toBe(false);
    expect(validateShopDomain(5 as unknown as string).ok).toBe(false);
    expect(validateShopDomain(null as unknown as string).ok).toBe(false);
  });
});

describe("validateShopDomain: failure message", () => {
  it("tells the owner what to enter, in plain words", () => {
    const r = validateShopDomain("https://x.myshopify.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Enter your store address, like my-store.myshopify.com.");
  });
});
