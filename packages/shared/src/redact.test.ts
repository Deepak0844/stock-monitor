import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("replaces values of secret-like keys", () => {
    const out = redactSecrets({ password: "hunter2", user: "ann" });
    expect(out).toEqual({ password: "[REDACTED]", user: "ann" });
  });

  it("redacts nested objects and arrays", () => {
    const out = redactSecrets({ a: { b: [{ sessionToken: "t0k3n" }] } });
    expect(JSON.stringify(out)).not.toContain("t0k3n");
  });

  it("matches cookie, authorization, secret and api key names case-insensitively", () => {
    const out = redactSecrets({
      Cookie: "c1",
      Authorization: "Bearer a1",
      clientSecret: "s1",
      API_KEY: "k1",
    });
    expect(JSON.stringify(out)).not.toMatch(/c1|a1|s1|k1/);
  });

  it("does not change the input object", () => {
    const input = { password: "hunter2" };
    redactSecrets(input);
    expect(input.password).toBe("hunter2");
  });

  it("leaves non-secret values untouched", () => {
    expect(redactSecrets({ sku: "ABC-1", qty: 4 })).toEqual({ sku: "ABC-1", qty: 4 });
  });

  it("handles circular references without throwing", () => {
    const a: Record<string, unknown> = { name: "x" };
    a.self = a;
    expect(() => redactSecrets(a)).not.toThrow();
  });
});
