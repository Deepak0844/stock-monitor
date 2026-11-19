import { describe, expect, it } from "vitest";
import { stableId } from "./login-inspect.js";

describe("stableId", () => {
  it.each(["UserName", "customer-email", "login_btn", "Password", "dupbtn"])("%s looks written by a person", (id) => {
    expect(stableId(id)).toBe(true);
  });
  it.each(["ember123", ":r1:", "a1b2c3d4e5f6", "", "x".repeat(61), "1abc", "has space"])("%s does not", (id) => {
    expect(stableId(id)).toBe(false);
  });
});
