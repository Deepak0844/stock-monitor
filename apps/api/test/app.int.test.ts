import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";

let t: TestDb;
const logLines: string[] = [];
const logStream = new Writable({
  write(chunk, _enc, cb) {
    logLines.push(chunk.toString());
    cb();
  },
});

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

function app() {
  return buildApp({ db: t.appDb, logger: createLogger({ level: "info", stream: logStream }) });
}

async function signIn(email: string, expiresIn = "1 day") {
  const user = await t.pool.query(
    "insert into users (email, password_hash) values ($1, 'h') returning id",
    [email],
  );
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await t.pool.query(
    `insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + $3::interval)`,
    [user.rows[0].id, tokenHash, expiresIn],
  );
  return token;
}

describe("health", () => {
  it("answers without a login", async () => {
    const res = await app().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("route protection", () => {
  it("returns 401 with a plain message when there is no session cookie", async () => {
    const res = await app().inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
    expect(res.json().error.message).toBe("Please sign in to continue.");
  });

  it("returns 401 for a cookie that matches no session", async () => {
    const res = await app().inject({
      method: "GET",
      url: "/api/me",
      cookies: { sid: "not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for an expired session", async () => {
    const token = await signIn("expired@x.com", "-1 minute");
    const res = await app().inject({ method: "GET", url: "/api/me", cookies: { sid: token } });
    expect(res.statusCode).toBe(401);
  });

  it("returns the signed-in user for a valid session", async () => {
    const token = await signIn("owner@x.com");
    const res = await app().inject({ method: "GET", url: "/api/me", cookies: { sid: token } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: "owner@x.com" });
  });

  it("never returns the password hash", async () => {
    const token = await signIn("nohash@x.com");
    const res = await app().inject({ method: "GET", url: "/api/me", cookies: { sid: token } });
    expect(res.body).not.toContain("password");
  });
});

describe("errors", () => {
  it("returns a generic 500 without a stack trace", async () => {
    const a = app();
    const token = await signIn("boom@x.com");
    a.get("/api/boom", async () => {
      throw new Error("db password is hunter2");
    });
    const res = await a.inject({ method: "GET", url: "/api/boom", cookies: { sid: token } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("internal_error");
    expect(res.body).not.toContain("hunter2");
    expect(res.body).not.toMatch(/\bat\s.+\(.+:\d+:\d+\)/);
  });

  it("returns a stable 404 for unknown routes when signed in", async () => {
    const token = await signIn("nf@x.com");
    const res = await app().inject({ method: "GET", url: "/nope", cookies: { sid: token } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("returns 401, not 404, for unknown routes when signed out, so routes are not revealed", async () => {
    const res = await app().inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(401);
  });

  it("includes the request id in the header and the error body", async () => {
    const res = await app().inject({ method: "GET", url: "/api/me" });
    const id = res.headers["x-request-id"];
    expect(id).toBeTruthy();
    expect(res.json().error.requestId).toBe(id);
  });
});

describe("logging", () => {
  it("does not log the session cookie value", async () => {
    const secret = "SESSION-COOKIE-SECRET-xyz";
    await app().inject({ method: "GET", url: "/api/me", cookies: { sid: secret } });
    expect(logLines.join("")).not.toContain(secret);
  });
});
