import { describe, expect, it } from "vitest";
import { findCode, senderMatches, siteOf } from "./code-mail.js";

describe("finding a login code in an email", () => {
  it.each([
    ["Your verification code is 482913.", "482913"],
    ["Use code: AB12CD to sign in", "AB12CD"],
    ["OTP 7731", "7731"],
    ["Hello 123456 regards", "123456"],
    ["Your one-time passcode\n\n  905513  \n\nIt expires in 10 minutes.", "905513"],
    ["Security alert: sign-in on 19 Nov 2026. Your code is 559021", "559021"],
    ["Verification of order AB1234 is done. Your code: 559021", "559021"],
    ["Your verification code is below.\n\n  4821  ", "4821"],
  ])("finds the code in %j", (text, code) => expect(findCode(text)).toBe(code));

  it.each([
    ["Order 12345678 shipped", "no code word, and not 6 digits"],
    ["Codes 111111 and 222222", "two candidates and no code word"],
    ["Your code is 123456789", "too long"],
    ["Your code is ABCDEF", "no digit"],
    ["Nothing here", "no candidate"],
  ])("finds nothing in %j (%s)", (text) => expect(findCode(text)).toBeNull());
});

describe("the site of a host", () => {
  it.each([
    ["www.acme.co.uk", "acme.co.uk"],
    ["mail.acme.com", "acme.com"],
    ["acme.com", "acme.com"],
  ])("%s is %s", (host, site) => expect(siteOf(host)).toBe(site));
});

describe("whose email it is", () => {
  it("matches the supplier's website by site", () => {
    expect(senderMatches("noreply@mail.acme.co.uk", "https://www.acme.co.uk/", null)).toBe(true);
    expect(senderMatches("x@acme.com", "https://shop.acme.co.uk/", null)).toBe(false);
  });
  it("uses the code email sender instead when it is set: a domain by site, an address exactly", () => {
    expect(senderMatches("a@login.example.net", "https://acme.com/", "login.example.net")).toBe(true);
    expect(senderMatches("a@x.example.net", "https://acme.com/", "login.example.net")).toBe(true);
    expect(senderMatches("noreply@acme.com", "https://acme.com/", "login.example.net")).toBe(false);
    expect(senderMatches("Codes@Example.net", "https://acme.com/", "codes@example.net")).toBe(true);
    expect(senderMatches("other@example.net", "https://acme.com/", "codes@example.net")).toBe(false);
  });
});
