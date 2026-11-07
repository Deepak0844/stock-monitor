import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, loadKey } from "./index.js";

const key = randomBytes(32);

describe("encrypt and decrypt", () => {
  it("returns the original text after a round trip", () => {
    const enc = encrypt("session-cookie-value", key, "k1");
    expect(decrypt(enc, key)).toBe("session-cookie-value");
  });

  it("handles empty and unicode text", () => {
    expect(decrypt(encrypt("", key, "k1"), key)).toBe("");
    expect(decrypt(encrypt("£11.39 ✓", key, "k1"), key)).toBe("£11.39 ✓");
  });

  it("does not contain the plaintext in the output", () => {
    const enc = encrypt("super-secret-value", key, "k1");
    expect(JSON.stringify(enc)).not.toContain("super-secret-value");
  });

  it("uses a different iv each time, so the same text encrypts differently", () => {
    const a = encrypt("same", key, "k1");
    const b = encrypt("same", key, "k1");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("records the key id", () => {
    expect(encrypt("x", key, "2026-11").keyId).toBe("2026-11");
  });

  it("throws when the ciphertext was changed", () => {
    const enc = encrypt("hello world", key, "k1");
    const bytes = Buffer.from(enc.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(() => decrypt({ ...enc, ciphertext: bytes.toString("base64") }, key)).toThrow();
  });

  it("throws when the tag was changed", () => {
    const enc = encrypt("hello world", key, "k1");
    const tag = Buffer.from(enc.tag, "base64");
    tag[0] = (tag[0] ?? 0) ^ 1;
    expect(() => decrypt({ ...enc, tag: tag.toString("base64") }, key)).toThrow();
  });

  it("throws when the iv was changed", () => {
    const enc = encrypt("hello world", key, "k1");
    const iv = Buffer.from(enc.iv, "base64");
    iv[0] = (iv[0] ?? 0) ^ 1;
    expect(() => decrypt({ ...enc, iv: iv.toString("base64") }, key)).toThrow();
  });

  it("throws with the wrong key", () => {
    const enc = encrypt("hello world", key, "k1");
    expect(() => decrypt(enc, randomBytes(32))).toThrow();
  });

  it("refuses to encrypt with a key that is not 32 bytes", () => {
    expect(() => encrypt("x", randomBytes(16), "k1")).toThrow(/32 bytes/);
  });
});

describe("loadKey", () => {
  it("decodes a 32 byte base64 key", () => {
    const b64 = randomBytes(32).toString("base64");
    expect(loadKey(b64).length).toBe(32);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => loadKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("rejects a missing key", () => {
    expect(() => loadKey(undefined)).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("does not print the key value in the error", () => {
    const bad = randomBytes(16).toString("base64");
    try {
      loadKey(bad);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain(bad);
    }
  });
});
