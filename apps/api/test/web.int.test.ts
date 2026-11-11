import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";

let t: TestDb;
let webRoot: string;

beforeAll(async () => {
  t = await startTestDb();
  webRoot = mkdtempSync(join(tmpdir(), "web-"));
  mkdirSync(join(webRoot, "assets"));
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Stock Monitor</title>");
  writeFileSync(join(webRoot, "assets", "app.js"), "console.log('app')");
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

const logger = () =>
  createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const withWeb = () => buildApp({ db: t.appDb, logger: logger(), webRoot });
const withoutWeb = () => buildApp({ db: t.appDb, logger: logger() });

describe("serving the web app", () => {
  it("serves index.html at / without a login", async () => {
    const res = await withWeb().inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Stock Monitor");
  });

  it("serves built assets without a login", async () => {
    const res = await withWeb().inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("console.log");
  });

  it("serves index.html for app routes such as /login, so deep links work", async () => {
    const res = await withWeb().inject({ method: "GET", url: "/suppliers/42" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Stock Monitor");
  });

  it("still protects the API", async () => {
    const a = withWeb();
    expect((await a.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
    expect((await a.inject({ method: "GET", url: "/api/anything" })).statusCode).toBe(401);
  });

  it("does not serve pages when no web folder is configured", async () => {
    const res = await withoutWeb().inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
  });
});

describe("security headers", () => {
  it("sends headers that block framing, sniffing and outside scripts", async () => {
    const res = await withWeb().inject({ method: "GET", url: "/" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("allows inline styles for the UI library but never inline scripts", async () => {
    const res = await withWeb().inject({ method: "GET", url: "/" });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain("unsafe-eval");
  });

  it("also sends them on API errors", async () => {
    const res = await withWeb().inject({ method: "GET", url: "/api/me" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
