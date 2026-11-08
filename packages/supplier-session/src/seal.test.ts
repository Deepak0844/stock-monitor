import { randomBytes } from "node:crypto";
import { encrypt } from "@stock-monitor/crypto";
import { describe, expect, it } from "vitest";
import { sealSessionState, unsealSessionState } from "./seal.js";

const key = randomBytes(32);
const COOKIE_VALUE = "SESSION-COOKIE-SECRET-VALUE-9f3a";
const TOKEN_VALUE = "LOCAL-STORAGE-TOKEN-VALUE-77c1";
const state = {
  cookies: [
    { name: "session", value: COOKIE_VALUE, domain: "shop.acme.example", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
  ],
  origins: [{ origin: "https://shop.acme.example", localStorage: [{ name: "auth", value: TOKEN_VALUE }] }],
};

describe("sealSessionState and unsealSessionState", () => {
  it("gives back exactly what was sealed", () => {
    expect(unsealSessionState(sealSessionState(state, key, "v1"), key)).toEqual(state);
  });

  it("records which key sealed it", () => {
    expect(sealSessionState(state, key, "v7").keyId).toBe("v7");
  });

  it("contains none of the secret values, names or addresses in any stored field", () => {
    const stored = JSON.stringify(sealSessionState(state, key, "v1"));
    for (const secret of [COOKIE_VALUE, TOKEN_VALUE, "shop.acme.example", "session", "localStorage", "cookies"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("makes a different result each time, so equal sessions cannot be recognised", () => {
    const a = sealSessionState(state, key, "v1");
    const b = sealSessionState(state, key, "v1");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it.each(["ciphertext", "tag", "iv"] as const)("refuses state whose %s was changed", (field) => {
    const sealed = sealSessionState(state, key, "v1");
    const bytes = Buffer.from(sealed[field], "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(() => unsealSessionState({ ...sealed, [field]: bytes.toString("base64") }, key)).toThrow(/could not be read/);
  });

  it("refuses the wrong key", () => {
    expect(() => unsealSessionState(sealSessionState(state, key, "v1"), randomBytes(32))).toThrow(/could not be read/);
  });

  it("never puts the secret in an error message", () => {
    const sealed = sealSessionState(state, key, "v1");
    try {
      unsealSessionState({ ...sealed, tag: Buffer.alloc(16).toString("base64") }, key);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(COOKIE_VALUE);
    }
  });

  it("refuses something that is not a Playwright session state, before sealing", () => {
    for (const bad of [null, undefined, "text", 5, [], {}, { cookies: [] }, { origins: [] }, { cookies: "x", origins: [] }, { cookies: [], origins: {} }]) {
      expect(() => sealSessionState(bad, key, "v1"), JSON.stringify(bad)).toThrow(/not a saved session/);
    }
  });

  it("accepts an empty session", () => {
    const empty = { cookies: [], origins: [] };
    expect(unsealSessionState(sealSessionState(empty, key, "v1"), key)).toEqual(empty);
  });

  it("refuses text that decrypts fine but is not a session state", () => {
    expect(() => unsealSessionState(encrypt("not json", key, "v1"), key)).toThrow(/could not be read/);
    expect(() => unsealSessionState(encrypt(JSON.stringify({ hello: 1 }), key, "v1"), key)).toThrow(/could not be read/);
  });
});
