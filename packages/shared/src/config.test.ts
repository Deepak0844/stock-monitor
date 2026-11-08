import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { loadConfig } from "./config.js";

const validKey = randomBytes(32).toString("base64");
const valid = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://app:pw@localhost:5432/stock",
  APP_ENCRYPTION_KEY: validKey,
};

describe("loadConfig", () => {
  it("returns typed config with defaults", () => {
    const config = loadConfig(valid);
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe("info");
    expect(config.databaseUrl).toBe(valid.DATABASE_URL);
  });

  it("decodes the encryption key to 32 bytes", () => {
    expect(loadConfig(valid).encryptionKey.length).toBe(32);
  });

  it("names every missing variable in the error", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({})).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    const short = randomBytes(16).toString("base64");
    expect(() => loadConfig({ ...valid, APP_ENCRYPTION_KEY: short })).toThrow(
      /APP_ENCRYPTION_KEY/,
    );
  });

  it("never prints the bad key value in the error", () => {
    const short = randomBytes(16).toString("base64");
    try {
      loadConfig({ ...valid, APP_ENCRYPTION_KEY: short });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain(short);
    }
  });

  it("rejects a malformed DATABASE_URL", () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: "not a url" })).toThrow(/DATABASE_URL/);
  });

  it("listens on 127.0.0.1 unless told otherwise", () => {
    expect(loadConfig(valid).host).toBe("127.0.0.1");
    expect(loadConfig({ ...valid, HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
  });

  it("uses secure cookies by default only in production", () => {
    expect(loadConfig({ ...valid, NODE_ENV: "production" }).cookieSecure).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: "development" }).cookieSecure).toBe(false);
  });

  it("lets COOKIE_SECURE override the default, for plain-http local runs", () => {
    expect(loadConfig({ ...valid, NODE_ENV: "production", COOKIE_SECURE: "false" }).cookieSecure).toBe(false);
    expect(loadConfig({ ...valid, NODE_ENV: "development", COOKIE_SECURE: "true" }).cookieSecure).toBe(true);
  });

  it("does not trust proxy headers unless TRUST_PROXY is true", () => {
    expect(loadConfig(valid).trustProxy).toBe(false);
    expect(loadConfig({ ...valid, TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });

  it("rejects a boolean setting that is not true or false", () => {
    expect(() => loadConfig({ ...valid, COOKIE_SECURE: "yes" })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...valid, TRUST_PROXY: "1" })).toThrow(/TRUST_PROXY/);
  });
});
