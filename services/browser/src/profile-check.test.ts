import { describe, expect, it } from "vitest";
import { classifyByTitle } from "./profile-check.js";

const at = (over: Partial<Parameters<typeof classifyByTitle>[0]>) =>
  classifyByTitle({ url: "https://shop.acme.example/list", finalUrl: "https://shop.acme.example/list", title: "Wholesale list", ...over });

describe("classifyByTitle", () => {
  it("calls a normal page on the same site ok", () => expect(at({})).toBe("ok"));
  it("never calls a missing page ok", () => expect(at({ finalUrl: null })).toBe("unknown"));
  it.each([["Just a moment..."], ["Attention Required! | Cloudflare"], ["Verify you are human"]])("%s is a captcha", (title) =>
    expect(at({ title })).toBe("captcha"));
  it.each([["Access denied"], ["403 Forbidden"]])("%s is blocked", (title) => expect(at({ title })).toBe("blocked"));
  it("sees a login redirect", () => expect(at({ finalUrl: "https://shop.acme.example/account/login?x=1" })).toBe("login_required"));
  it("sees the owner's own login address", () =>
    expect(at({ finalUrl: "https://shop.acme.example/enter", loginUrl: "https://shop.acme.example/enter" })).toBe("login_required"));
  it("does not trust another site or an empty title", () => {
    expect(at({ finalUrl: "https://evil.example/list" })).toBe("unknown");
    expect(at({ title: " " })).toBe("unknown");
  });
});
