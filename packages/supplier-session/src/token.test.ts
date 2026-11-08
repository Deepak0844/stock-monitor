import { describe, expect, it } from "vitest";
import { createLoginToken, hashToken, tokenMatchesHash } from "./token.js";

describe("createLoginToken", () => {
  it("makes a 256-bit random token as 64 hex characters", () => {
    expect(createLoginToken().token).toMatch(/^[0-9a-f]{64}$/);
  });
  it("makes a different token every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createLoginToken().token));
    expect(tokens.size).toBe(200);
  });
  it("returns a hash to store, which is not the token and does not contain it", () => {
    const { token, hash } = createLoginToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
    expect(hash).toBe(hashToken(token));
  });
});

describe("hashToken", () => {
  it("is the same for the same token and different for another", () => {
    expect(hashToken("a".repeat(64))).toBe(hashToken("a".repeat(64)));
    expect(hashToken("a".repeat(64))).not.toBe(hashToken("b".repeat(64)));
  });
});

describe("tokenMatchesHash", () => {
  const { token, hash } = createLoginToken();
  it("accepts the right token", () => expect(tokenMatchesHash(token, hash)).toBe(true));
  it("refuses another token, a changed token and a token with something added", () => {
    expect(tokenMatchesHash(createLoginToken().token, hash)).toBe(false);
    expect(tokenMatchesHash(`${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`, hash)).toBe(false);
    expect(tokenMatchesHash(`${token} `, hash)).toBe(false);
    expect(tokenMatchesHash(token.toUpperCase(), hash)).toBe(false);
  });
  it("refuses the hash given as if it were the token", () => expect(tokenMatchesHash(hash, hash)).toBe(false));
  it("refuses anything that is not a token, without throwing", () => {
    for (const bad of ["", "short", "g".repeat(64), undefined, null, 5, {}, [], "a".repeat(10_000)]) {
      expect(tokenMatchesHash(bad as never, hash), String(bad)).toBe(false);
    }
  });
  it("refuses a stored hash of the wrong shape, without throwing", () => {
    for (const bad of ["", "short", "g".repeat(64), "a".repeat(63)]) expect(tokenMatchesHash(token, bad)).toBe(false);
  });
});
