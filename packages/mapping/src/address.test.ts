import { describe, expect, it } from "vitest";
import { cleanAddress, sameSite } from "./address.js";

describe("cleanAddress", () => {
  it("uses a plain address", () => {
    expect(cleanAddress("https://acme.test/p/blue")).toEqual({ ok: true, url: "https://acme.test/p/blue" });
  });

  it("uses the first address of a list written as JSON", () => {
    expect(cleanAddress('["https://acme.test/p/1","https://acme.test/p/2"]')).toEqual({ ok: true, url: "https://acme.test/p/1" });
  });

  it("finds an address inside a longer JSON cell, with escaped slashes", () => {
    const cell = '[{"label":"Page","url":"https:\\/\\/acme.test\\/p\\/9"}]';
    expect(cleanAddress(cell)).toEqual({ ok: true, url: "https://acme.test/p/9" });
  });

  it("removes only the four tracking parts and keeps ?variant=", () => {
    expect(cleanAddress("https://acme.test/p/1?_pos=3&_psq=x&variant=77&_psid=1&_ss=r")).toEqual({
      ok: true,
      url: "https://acme.test/p/1?variant=77",
    });
  });

  it("leaves other parameters alone", () => {
    expect(cleanAddress("https://acme.test/p/1?utm_source=a&_pos=3")).toEqual({ ok: true, url: "https://acme.test/p/1?utm_source=a" });
  });

  it("says plainly when there is no address", () => {
    expect(cleanAddress("")).toEqual({ ok: false, message: "No address in that row." });
    expect(cleanAddress("see supplier site")).toEqual({ ok: false, message: "No address in that row." });
  });

  it("refuses http and IP addresses with the supplier-address messages", () => {
    expect(cleanAddress("http://acme.test/p")).toMatchObject({ ok: false });
    expect(cleanAddress("https://10.0.0.1/p")).toMatchObject({ ok: false });
  });
});

describe("sameSite", () => {
  it("accepts the same host and subdomains, ignoring www", () => {
    expect(sameSite("https://acme.test/p", "acme.test")).toBe(true);
    expect(sameSite("https://www.acme.test/p", "acme.test")).toBe(true);
    expect(sameSite("https://acme.test/p", "www.acme.test")).toBe(true);
    expect(sameSite("https://shop.acme.test/p", "acme.test")).toBe(true);
  });
  it("refuses another site, including look-alikes", () => {
    expect(sameSite("https://other.test/p", "acme.test")).toBe(false);
    expect(sameSite("https://notacme.test/p", "acme.test")).toBe(false);
    expect(sameSite("https://acme.test.evil.test/p", "acme.test")).toBe(false);
  });
});
