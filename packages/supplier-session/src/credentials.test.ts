import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isCredentials, isLoginSelectors, sealCredentials, unsealCredentials } from "./credentials.js";

const key = randomBytes(32);

describe("sealCredentials and unsealCredentials", () => {
  it("round-trips exactly", () => {
    const c = { username: "a@b.c", password: "p\"'😀" + "x".repeat(190) };
    expect(unsealCredentials(sealCredentials(c, key, "k1"), key)).toEqual(c);
  });

  it("ciphertext holds no plain text", () => {
    const c = { username: "plainuser", password: "plainpass" };
    const sealed = sealCredentials(c, key, "k1");
    expect(sealed.ciphertext).not.toContain("plainuser");
    expect(sealed.ciphertext).not.toContain("plainpass");
  });

  it("rejects bad shapes", () => {
    expect(isCredentials({ username: "", password: "x" })).toBe(false);
    expect(isCredentials({ username: "a", password: "x".repeat(201) })).toBe(false);
    expect(isCredentials({ username: "a", password: "b", extra: 1 })).toBe(false);
    expect(isCredentials({ username: "a", password: "b", account: "" })).toBe(false);
    const withAccount = { username: "a", password: "b", account: "C-1042" };
    expect(isCredentials(withAccount)).toBe(true);
    expect(unsealCredentials(sealCredentials(withAccount, key, "k1"), key)).toEqual(withAccount);
  });

  it("throws on a bad shape without leaking values", () => {
    expect(() => sealCredentials({ username: "", password: "secretpw" }, key, "k1")).toThrow(/credentials/i);
  });
});

describe("isLoginSelectors", () => {
  it("accepts empty and partial selector sets", () => {
    expect(isLoginSelectors({})).toBe(true);
    expect(isLoginSelectors({ open: "#login", account: "#acct", username: "#u", password: "#p", submit: "button" })).toBe(true);
  });
  it("rejects unknown keys, empty, non-string and too long values", () => {
    expect(isLoginSelectors({ other: "#x" })).toBe(false);
    expect(isLoginSelectors({ username: "" })).toBe(false);
    expect(isLoginSelectors({ username: 5 })).toBe(false);
    expect(isLoginSelectors({ username: "x".repeat(201) })).toBe(false);
    expect(isLoginSelectors({ username: "x".repeat(200) })).toBe(true);
    expect(isLoginSelectors(null)).toBe(false);
    expect(isLoginSelectors([])).toBe(false);
  });
});
