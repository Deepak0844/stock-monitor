import { describe, expect, it } from "vitest";
import { mergeSessionState, sameSessionState } from "./merge.js";

const c = (name: string, value: string, expires = -1, domain = ".acme.example", path = "/") => ({ name, value, domain, path, expires });
const origin = { origin: "https://acme.example", localStorage: [{ name: "cart", value: "1" }] };

describe("mergeSessionState", () => {
  it("a fresh cookie replaces the saved one with the same name, domain and path", () =>
    expect(mergeSessionState({ cookies: [c("sid", "old")], origins: [] }, { cookies: [c("sid", "new")], origins: [] }, 1000).cookies).toEqual([c("sid", "new")]));

  it("keeps a saved cookie the fresh state left out, so a session-only cookie is not lost", () =>
    expect(mergeSessionState({ cookies: [c("sid", "x")], origins: [] }, { cookies: [c("_ga", "y", 5000)], origins: [] }, 1000).cookies).toEqual(
      expect.arrayContaining([c("sid", "x"), c("_ga", "y", 5000)]),
    ));

  it("drops a left-out saved cookie that has expired", () =>
    expect(mergeSessionState({ cookies: [c("old", "x", 500)], origins: [] }, { cookies: [], origins: [] }, 1000).cookies).toEqual([]));

  it("treats the same name on another path as another cookie", () =>
    expect(mergeSessionState({ cookies: [c("sid", "a", -1, ".acme.example", "/a")], origins: [] }, { cookies: [c("sid", "b")], origins: [] }, 1000).cookies).toHaveLength(2));

  it("keeps the saved origins when the fresh state has none", () =>
    expect(mergeSessionState({ cookies: [], origins: [origin] }, { cookies: [], origins: [] }, 1000).origins).toEqual([origin]));

  it("uses the fresh origins when there are some, without adding the saved ones", () => {
    const fresh = { origin: "https://acme.example", localStorage: [] };
    expect(mergeSessionState({ cookies: [], origins: [origin] }, { cookies: [], origins: [fresh] }, 1000).origins).toEqual([fresh]);
  });
});

describe("sameSessionState", () => {
  it("ignores cookie order", () =>
    expect(sameSessionState({ cookies: [c("a", "1"), c("b", "2")], origins: [] }, { cookies: [c("b", "2"), c("a", "1")], origins: [] })).toBe(true));

  it("sees a changed value", () => expect(sameSessionState({ cookies: [c("a", "1")], origins: [] }, { cookies: [c("a", "2")], origins: [] })).toBe(false));

  it("sees a changed expiry", () => expect(sameSessionState({ cookies: [c("a", "1", 10)], origins: [] }, { cookies: [c("a", "1", 20)], origins: [] })).toBe(false));
});
