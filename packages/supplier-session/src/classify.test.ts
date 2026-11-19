import { describe, expect, it } from "vitest";
import { classifyPage, explainPage, type PageFacts } from "./classify.js";
import { fixtures } from "../test/fixtures.js";

describe("classifyPage on saved example pages", () => {
  it.each(fixtures.map((f) => [f.name, f] as const))("%s", (_name, fixture) => {
    expect(classifyPage(fixture.facts)).toBe(fixture.expected);
  });
});

describe("classifyPage never calls an unclear page ok", () => {
  const long = "Acme wholesale catalogue. ".repeat(30);
  const base = (over: Partial<NonNullable<PageFacts["page"]>>): PageFacts => ({
    requestedUrl: "https://shop.acme.example/a",
    page: { finalUrl: "https://shop.acme.example/a", status: 200, title: "Acme", text: long, hasPasswordField: false, hasChallengeWidget: false, ...over },
  });

  it("calls a clear, healthy page ok (so the test below proves something)", () => {
    expect(classifyPage(base({}))).toBe("ok");
  });

  it("keeps ok for exactly these conditions: a 2xx answer on the same site, real content, and no warning sign", () => {
    const statuses = [null, 100, 200, 204, 301, 302, 401, 403, 404, 418, 429, 500, 503];
    const texts = ["", "Loading...", long, `${long} verify you are human`, `${long} access denied`, `${long} log in to see prices`, "Access denied", "Page not found"];
    const titles = ["", "Acme", "Just a moment...", "Access denied", "Log in", "Page not found", "Session expired"];
    const urls = ["https://shop.acme.example/a", "https://shop.acme.example/login", "https://evil.example/a", "https://www.shop.acme.example/a"];
    for (const status of statuses)
      for (const text of texts)
        for (const title of titles)
          for (const finalUrl of urls)
            for (const hasPasswordField of [false, true])
              for (const hasChallengeWidget of [false, true]) {
                const f = base({ status, text, title, finalUrl, hasPasswordField, hasChallengeWidget });
                if (classifyPage(f) !== "ok") continue;
                const ctx = JSON.stringify(f.page);
                expect(status !== null && status >= 200 && status < 300, ctx).toBe(true);
                expect(text.length >= 200, ctx).toBe(true);
                expect(hasPasswordField || hasChallengeWidget, ctx).toBe(false);
                expect(new URL(finalUrl).host.replace(/^www\./, ""), ctx).toBe("shop.acme.example");
                expect(finalUrl.includes("login"), ctx).toBe(false);
                expect(`${title} ${text}`.toLowerCase(), ctx).not.toMatch(/just a moment|verify you are human|access denied|session expired|to see prices|page not found/);
              }
  });
});

describe("classifyPage details", () => {
  const at = (over: Partial<NonNullable<PageFacts["page"]>>, extra: Partial<PageFacts> = {}): PageFacts => ({
    requestedUrl: "https://shop.acme.example/a",
    page: { finalUrl: "https://shop.acme.example/a", status: 200, title: "Acme", text: "Acme wholesale catalogue. ".repeat(30), hasPasswordField: false, hasChallengeWidget: false, ...over },
    ...extra,
  });

  it("only treats the owner's login address as a login page when the path matches, ignoring the query", () => {
    const loginUrl = "https://shop.acme.example/entrance";
    expect(classifyPage(at({ finalUrl: "https://shop.acme.example/entrance?next=%2Fa" }, { loginUrl }))).toBe("login_required");
    expect(classifyPage(at({ finalUrl: "https://shop.acme.example/entrance-hall-chairs" }, { loginUrl }))).toBe("ok");
  });

  it("recognises common login addresses without being told", () => {
    for (const path of ["/login", "/signin", "/sign-in", "/account/login", "/customer/login", "/users/sign_in"]) {
      expect(classifyPage(at({ finalUrl: `https://shop.acme.example${path}` })), path).toBe("login_required");
    }
    expect(classifyPage(at({ finalUrl: "https://shop.acme.example/products/login-kit" }))).toBe("ok");
  });

  it("puts a challenge before a block, because it can be solved by hand", () => {
    expect(classifyPage(at({ status: 403, hasChallengeWidget: true }))).toBe("captcha");
  });

  it("matches wording whatever the case, spacing or apostrophe", () => {
    expect(classifyPage(at({ title: "Check", text: "VERIFY   YOU\n ARE   HUMAN" }))).toBe("captcha");
    expect(classifyPage(at({ title: "Check", text: "Verify you’re human" }))).toBe("captcha");
  });

  it("ignores warning wording buried in a long page, but not in the title", () => {
    expect(classifyPage(at({ text: `${"Acme wholesale catalogue. ".repeat(200)} access denied` }))).toBe("ok");
    expect(classifyPage(at({ title: "Access denied", text: "Acme wholesale catalogue. ".repeat(200) }))).toBe("blocked");
  });
});

describe("classifyPage for a supplier whose pages need no login", () => {
  const at = (over: Partial<NonNullable<PageFacts["page"]>>, extra: Partial<PageFacts> = {}): PageFacts => ({
    requestedUrl: "https://shop.acme.example/p/tee",
    page: { finalUrl: "https://shop.acme.example/p/tee", status: 200, title: "Blue Tee", text: `Blue Tee. Please log in to see prices. ${"Soft cotton. ".repeat(30)}`, hasPasswordField: false, hasChallengeWidget: false, ...over },
    ...extra,
  });

  it("does not take login wording on a public page as a login wall", () => {
    expect(classifyPage(at({}))).toBe("login_required");
    expect(classifyPage(at({}, { publicPage: true }))).toBe("ok");
  });

  it("still knows a real login page: a password box, a login address, a login title, or 401", () => {
    expect(classifyPage(at({ hasPasswordField: true }, { publicPage: true }))).toBe("login_required");
    expect(classifyPage(at({ finalUrl: "https://shop.acme.example/account/login" }, { publicPage: true }))).toBe("login_required");
    expect(classifyPage(at({ title: "Please log in" }, { publicPage: true }))).toBe("login_required");
    expect(classifyPage(at({ status: 401 }, { publicPage: true }))).toBe("login_required");
  });
});

describe("classifyPage with a logged-in marker", () => {
  const at = (over: Partial<NonNullable<PageFacts["page"]>>, extra: Partial<PageFacts> = {}): PageFacts => ({
    requestedUrl: "https://shop.acme.example/a",
    page: { finalUrl: "https://shop.acme.example/a", status: 200, title: "Acme", text: "Acme wholesale catalogue. ".repeat(30), hasPasswordField: false, hasChallengeWidget: false, ...over },
    ...extra,
  });

  it("calls a page that looks ok, but lacks the marker, a login page", () => {
    expect(explainPage(at({}, { loggedInMarker: "Log out" }))).toEqual({ result: "login_required", signal: "marker_missing" });
  });

  it("finds the marker whatever its case and spacing", () => {
    const text = `${"Acme wholesale catalogue. ".repeat(30)} LOG\n   OUT`;
    expect(explainPage(at({ text }, { loggedInMarker: "  log  out " }))).toEqual({ result: "ok", signal: "looks_real" });
  });

  it("checks the other rules first: a puzzle page with a marker set is still a puzzle", () => {
    expect(classifyPage(at({ hasChallengeWidget: true }, { loggedInMarker: "Log out" }))).toBe("captcha");
    expect(classifyPage(at({ status: 429 }, { loggedInMarker: "Log out" }))).toBe("blocked");
    expect(classifyPage(at({ text: "short" }, { loggedInMarker: "Log out" }))).toBe("unknown");
  });

  it("changes nothing when no marker is set", () => {
    expect(explainPage(at({}))).toEqual({ result: "ok", signal: "looks_real" });
    expect(explainPage(at({}, { loggedInMarker: "" }))).toEqual({ result: "ok", signal: "looks_real" });
  });
});
