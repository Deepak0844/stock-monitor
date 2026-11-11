import { describe, expect, it } from "vitest";
import { parseCookieExport } from "./import-cookies.js";

const NOW = 1_800_000_000;
const SITE = ["shop.example"];
const SECRET = "COOKIE-VALUE-SECRET-4d2e";
const cookie = (over: Record<string, unknown> = {}) => ({
  name: "session",
  value: SECRET,
  domain: "shop.example",
  path: "/",
  expirationDate: NOW + 3600,
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  ...over,
});
const parse = (input: unknown, hosts = SITE) => parseCookieExport(typeof input === "string" ? input : JSON.stringify(input), hosts, NOW);
const okState = (input: unknown, hosts = SITE) => {
  const r = parse(input, hosts);
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("parseCookieExport", () => {
  it("turns a Cookie-Editor array into a saved session", () => {
    const r = okState([cookie()]);
    expect(r.state).toEqual({
      cookies: [{ name: "session", value: SECRET, domain: "shop.example", path: "/", expires: NOW + 3600, httpOnly: true, secure: true, sameSite: "Lax" }],
      origins: [],
    });
    expect([r.kept, r.dropped]).toEqual([1, 0]);
  });

  it("maps same-site words and a missing expiry", () => {
    const r = okState([
      cookie({ name: "a", sameSite: "no_restriction", expirationDate: undefined }),
      cookie({ name: "b", sameSite: "strict" }),
      cookie({ name: "c", sameSite: "unspecified" }),
      cookie({ name: "d", sameSite: null }),
    ]);
    const by = Object.fromEntries(r.state.cookies.map((c) => [c.name, c]));
    expect([by.a.sameSite, by.a.expires]).toEqual(["None", -1]);
    expect(by.b.sameSite).toBe("Strict");
    expect(by.c.sameSite).toBe("Lax");
    expect(by.d.sameSite).toBe("Lax");
  });

  it("treats a session cookie flag and a missing path sensibly", () => {
    const r = okState([cookie({ session: true, expirationDate: undefined, path: undefined })]);
    expect(r.state.cookies[0]).toMatchObject({ expires: -1, path: "/" });
  });

  it("accepts a Playwright storage state and keeps only this site's storage", () => {
    const state = {
      cookies: [{ name: "s", value: SECRET, domain: ".shop.example", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
      origins: [
        { origin: "https://shop.example", localStorage: [{ name: "k", value: "v" }] },
        { origin: "https://other.example", localStorage: [{ name: "k", value: "v" }] },
      ],
    };
    const r = okState(state);
    expect(r.state.cookies).toHaveLength(1);
    expect(r.state.origins).toEqual([state.origins[0]]);
  });

  it("keeps the site, its parents and its subdomains, with or without a leading dot", () => {
    const r = okState([
      cookie({ name: "a", domain: "shop.example" }),
      cookie({ name: "b", domain: ".shop.example" }),
      cookie({ name: "c", domain: ".example" }),
      cookie({ name: "d", domain: "www.shop.example" }),
      cookie({ name: "e", domain: "other.example" }),
      cookie({ name: "f", domain: "ads.tracker.test" }),
      cookie({ name: "g", domain: ".com" }),
    ]);
    // ".example" has no dot inside it, so it is a top-level name and not a real parent site.
    expect(r.state.cookies.map((c) => c.name).sort()).toEqual(["a", "b", "d"]);
    expect([r.kept, r.dropped]).toEqual([3, 4]);
  });

  it("uses the site host for a cookie with no domain", () => {
    const r = okState([cookie({ name: "__Host-x", domain: undefined })]);
    expect(r.state.cookies[0]?.domain).toBe("shop.example");
  });

  it("drops cookies that have already expired", () => {
    const r = okState([cookie({ name: "old", expirationDate: NOW - 1 }), cookie({ name: "new" })]);
    expect(r.state.cookies.map((c) => c.name)).toEqual(["new"]);
    expect(r.dropped).toBe(1);
  });

  it("ignores a byte-order mark and surrounding spaces", () => {
    expect(parse(`${String.fromCharCode(0xfeff)}  ${JSON.stringify([cookie()])}  \n`).ok).toBe(true);
  });

  it("keeps at most 100 cookies", () => {
    const many = Array.from({ length: 150 }, (_, i) => cookie({ name: `c${i}` }));
    const r = okState(many);
    expect([r.kept, r.dropped]).toEqual([100, 50]);
  });

  it.each([
    ["not JSON", "hello"],
    ["an empty array", "[]"],
    ["a number", "42"],
    ["a cookie with no name", JSON.stringify([cookie({ name: "" })])],
    ["a cookie with no value", JSON.stringify([{ name: "a", domain: "shop.example" }])],
  ])("refuses %s with a plain message and no cookie value", (_label, input) => {
    const r = parse(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
  });

  it("explains that a Cookie header is the wrong format", () => {
    const r = parse(`session=${SECRET}; other=1`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JSON/);
  });

  it("refuses when nothing is left after filtering, and says why", () => {
    const r = parse([cookie({ domain: "other.example" }), cookie({ name: "old", expirationDate: NOW - 5 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/this supplier|that site|expired/i);
  });

  it("never puts a cookie value in an error message", () => {
    for (const input of [`session=${SECRET}`, JSON.stringify([cookie({ domain: "other.example" })]), JSON.stringify([{ name: "x", value: SECRET }])]) {
      const r = parse(input);
      if (!r.ok) expect(r.message).not.toContain(SECRET);
    }
  });
});
