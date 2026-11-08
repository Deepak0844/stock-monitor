import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";
import { createOwner } from "../src/owner.js";

const EMAIL = "owner@example.com";
const PASSWORD = "correct horse battery staple";

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

const silent = () =>
  createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const app = (secureCookies = false) => buildApp({ db: t.appDb, logger: silent(), secureCookies });
const login = (a: ReturnType<typeof app>, email: string, password: string) =>
  a.inject({ method: "POST", url: "/api/login", payload: { email, password } });
const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === "sid");

describe("createOwner", () => {
  it("stores an argon2id hash and a lowercased email, and writes an audit event", async () => {
    await createOwner(t.appDb, { email: "Owner@Example.com", password: PASSWORD });
    const { rows } = await t.pool.query("select email, password_hash from users");
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(EMAIL);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain(PASSWORD);
    const audit = await t.pool.query("select * from audit_events where action = 'owner.created'");
    expect(audit.rows).toHaveLength(1);
  });

  it("refuses a second owner", async () => {
    await expect(
      createOwner(t.appDb, { email: "second@example.com", password: PASSWORD }),
    ).rejects.toThrow(/already exists/i);
  });
});

describe("createOwner validation", () => {
  it("rejects a password shorter than 12 characters", async () => {
    await expect(createOwner(t.appDb, { email: "x@example.com", password: "short" })).rejects.toThrow(
      /at least 12/i,
    );
  });

  it("rejects an invalid email", async () => {
    await expect(
      createOwner(t.appDb, { email: "not-an-email", password: PASSWORD }),
    ).rejects.toThrow(/email/i);
  });
});

describe("login", () => {
  it("signs in with the right credentials and sets a safe cookie", async () => {
    const res = await login(app(), EMAIL, PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: EMAIL });
    const sid = res.headers["set-cookie"] as string;
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    expect(sid).toMatch(/Path=\//i);
    expect(sid).not.toMatch(/Secure/i);
  });

  it("sets the Secure flag when secure cookies are on", async () => {
    const res = await login(app(true), EMAIL, PASSWORD);
    expect(res.headers["set-cookie"] as string).toMatch(/Secure/i);
  });

  it("lets the session cookie reach protected routes, and stores only a hash", async () => {
    const a = app();
    const res = await login(a, EMAIL, PASSWORD);
    const token = cookieOf(res)!.value;
    const me = await a.inject({ method: "GET", url: "/api/me", cookies: { sid: token } });
    expect(me.statusCode).toBe(200);
    const { rows } = await t.pool.query("select token_hash from app_sessions");
    expect(rows.map((r) => r.token_hash)).not.toContain(token);
  });

  it("gives the same generic error for a wrong password and an unknown email", async () => {
    const a = app();
    const wrongPassword = await login(a, EMAIL, "wrong password here");
    const unknownEmail = await login(a, "nobody@example.com", "wrong password here");
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().error.code).toBe("invalid_credentials");
    expect(wrongPassword.json().error.message).toBe("Email or password is incorrect.");
    expect(unknownEmail.json().error.message).toBe(wrongPassword.json().error.message);
  });

  it("rejects a missing or malformed body with a plain message", async () => {
    const res = await app().inject({ method: "POST", url: "/api/login", payload: { email: 5 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
  });

  it("writes audit events for success and failure, without the password", async () => {
    const a = app();
    await login(a, EMAIL, PASSWORD);
    await login(a, EMAIL, "definitely-wrong-password");
    const { rows } = await t.pool.query(
      "select action, details from audit_events where action like 'login.%'",
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("login.succeeded");
    expect(actions).toContain("login.failed");
    const all = JSON.stringify(rows);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("definitely-wrong-password");
  });
});

describe("rate limit", () => {
  it("blocks after repeated failures, even with the correct password", async () => {
    const a = app();
    for (let i = 0; i < 5; i++) await login(a, EMAIL, `wrong-password-${i}`);
    const res = await login(a, EMAIL, PASSWORD);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("too_many_attempts");
  });
});

describe("logout", () => {
  it("ends the session, clears the cookie and writes an audit event", async () => {
    const a = app();
    const token = cookieOf(await login(a, EMAIL, PASSWORD))!.value;
    const out = await a.inject({ method: "POST", url: "/api/logout", cookies: { sid: token } });
    expect(out.statusCode).toBe(200);
    expect(out.headers["set-cookie"] as string).toMatch(/sid=;|Max-Age=0|Expires=/i);
    const me = await a.inject({ method: "GET", url: "/api/me", cookies: { sid: token } });
    expect(me.statusCode).toBe(401);
    const audit = await t.pool.query("select 1 from audit_events where action = 'logout'");
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("requires a session", async () => {
    const res = await app().inject({ method: "POST", url: "/api/logout" });
    expect(res.statusCode).toBe(401);
  });
});

describe("no public signup", () => {
  it.each(["/api/signup", "/api/register", "/api/users"])("%s is not reachable", async (url) => {
    const res = await app().inject({
      method: "POST",
      url,
      payload: { email: "evil@example.com", password: PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });
});
