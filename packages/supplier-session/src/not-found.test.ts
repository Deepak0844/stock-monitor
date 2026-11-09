import { describe, expect, it } from "vitest";
import { looksLikeNotFound } from "./not-found.js";

describe("looksLikeNotFound", () => {
  it.each([
    ["404 Not Found", null],
    ["Page not found", "Page not found"],
    ["Oops", "We couldn't find that page"],
    ["Product unavailable", null],
    ["Shop", "This product is no longer available"],
    ["Error", "That page does not exist"],
    ["Not found | Fake Supplier", "Not found"],
  ])("recognises %s / %s", (title, heading) => {
    expect(looksLikeNotFound({ title, heading })).toBe(true);
  });

  it.each([
    ["Blue Widget | Fake Supplier", "Blue Widget"],
    ["Log in", "Log in"],
    [null, null],
    ["", ""],
  ])("does not flag a normal page: %s / %s", (title, heading) => {
    expect(looksLikeNotFound({ title, heading })).toBe(false);
  });
});
