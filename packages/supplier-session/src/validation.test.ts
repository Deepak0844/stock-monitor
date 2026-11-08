import { describe, expect, it } from "vitest";
import { isPrivateAddress, validateSupplierUrl, verifyPublicHost, type HostLookup } from "./validation.js";

const accepted = (input: string) => {
  const r = validateSupplierUrl(input);
  return r.ok ? r.url : null;
};
const refusal = (input: unknown) => {
  const r = validateSupplierUrl(input);
  return r.ok ? null : r.message;
};

describe("validateSupplierUrl: accepts normal supplier websites", () => {
  it("keeps an https address and trims spaces", () => {
    expect(accepted("  https://shop.acme-supply.com/login  ")).toBe("https://shop.acme-supply.com/login");
  });
  it("lower-cases the host and drops a #fragment", () => {
    expect(accepted("https://Shop.Acme.com/Account#top")).toBe("https://shop.acme.com/Account");
  });
  it("keeps a query string", () => {
    expect(accepted("https://acme.com/sign-in?next=/orders")).toBe("https://acme.com/sign-in?next=/orders");
  });
  it("accepts the standard port written out", () => {
    expect(accepted("https://acme.com:443/")).toBe("https://acme.com/");
  });
});

describe("validateSupplierUrl: refuses anything that is not a plain public https website", () => {
  it.each([
    ["http", "http://acme.com"],
    ["ftp", "ftp://acme.com"],
    ["no scheme", "acme.com"],
    ["javascript", "javascript:alert(1)"],
    ["a file", "file:///etc/passwd"],
    ["empty", ""],
    ["only spaces", "   "],
  ])("%s", (_name, input) => expect(refusal(input)).toMatch(/https/i));

  it.each([
    ["IPv4", "https://93.184.216.34/"],
    ["loopback IP", "https://127.0.0.1/"],
    ["metadata IP", "https://169.254.169.254/latest/meta-data"],
    ["IPv6", "https://[2606:4700::1111]/"],
    ["IPv6 loopback", "https://[::1]/"],
    ["IPv4 as one number", "https://2130706433/"],
    ["IPv4 in hex", "https://0x7f000001/"],
    ["IPv4 in octal parts", "https://0177.0.0.1/"],
    ["IPv4 with short form", "https://127.1/"],
  ])("an IP address: %s", (_name, input) => expect(refusal(input)).toMatch(/name, not an IP/i));

  it.each([
    "https://localhost/",
    "https://LOCALHOST/",
    "https://app.localhost/",
    "https://printer.local/",
    "https://db.internal/",
    "https://intranet/",
    "https://localhost./",
  ])("a local or single-word name: %s", (input) => expect(refusal(input)).toMatch(/public website/i));

  it.each([
    ["x.com@evil.com", "https://acme.com@evil.com/"],
    ["user and password", "https://user:pass@acme.com/"],
    ["user only", "https://user@acme.com/"],
  ])("a username or password in the address: %s", (_name, input) => expect(refusal(input)).toMatch(/username|password/i));

  it.each([
    ["8080", "https://acme.com:8080/"],
    ["22", "https://acme.com:22/"],
    ["5432", "https://acme.com:5432/"],
  ])("a port other than the standard one: %s", (_name, input) => expect(refusal(input)).toMatch(/port/i));

  it.each([
    ["Cyrillic a", "https://аcme.com/"],
    ["punycode", "https://xn--cme-9cd.com/"],
    ["a full-width dot", "https://acme。com/"],
  ])("look-alike characters: %s", (_name, input) => expect(refusal(input)).toMatch(/plain letters/i));

  it("an address with a backslash trick", () => {
    expect(refusal("https://acme.com\\@evil.com/")).not.toBeNull();
  });
  it("something that is not text", () => {
    expect(refusal(undefined)).toMatch(/https/i);
    expect(refusal(42)).toMatch(/https/i);
  });
  it("an address that is too long", () => {
    expect(refusal(`https://acme.com/${"a".repeat(2100)}`)).toMatch(/too long/i);
  });
  it("a trailing-dot host is treated as the same host, not a way round the rules", () => {
    expect(accepted("https://acme.com./")).toBe("https://acme.com/");
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "192.0.0.1", "198.18.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
  ])("%s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.255.255", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "%s is public",
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );

  it("treats text that is not an IP address as private, so a bad answer is never trusted", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("verifyPublicHost", () => {
  const answer = (...addresses: string[]): HostLookup => async () => addresses;

  it("accepts a name that resolves to public addresses only", async () => {
    expect(await verifyPublicHost("acme.com", answer("93.184.216.34", "2606:4700::1111"))).toEqual({ ok: true });
  });
  it("refuses a name that resolves to a private address", async () => {
    const r = await verifyPublicHost("evil.example", answer("10.0.0.5"));
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/private|internal/i) });
  });
  it("refuses when any one of several addresses is private", async () => {
    const r = await verifyPublicHost("evil.example", answer("93.184.216.34", "127.0.0.1"));
    expect(r.ok).toBe(false);
  });
  it("refuses a name that resolves to the cloud metadata address", async () => {
    expect((await verifyPublicHost("evil.example", answer("169.254.169.254"))).ok).toBe(false);
  });
  it("refuses a name that resolves to nothing", async () => {
    const r = await verifyPublicHost("nowhere.example", answer());
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/find|reach/i) });
  });
  it("says it could not find the site when the lookup fails", async () => {
    const lookup: HostLookup = async () => { throw new Error("ENOTFOUND"); };
    expect(await verifyPublicHost("nowhere.example", lookup)).toEqual({ ok: false, message: expect.stringMatching(/find|reach/i) });
  });
});
