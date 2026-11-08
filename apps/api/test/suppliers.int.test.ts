import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createSupplierRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import type { HostLookup } from "@stock-monitor/supplier-session";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid: string;
let userId: string;
const lookedUp: string[] = [];
// Every name resolves to a public address unless the test says otherwise.
const dns: Record<string, string[] | Error> = {};
const lookup: HostLookup = async (host) => {
  lookedUp.push(host);
  const answer = dns[host] ?? ["93.184.216.34"];
  if (answer instanceof Error) throw answer;
  return answer;
};
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const app = () => buildApp({ db: t.appDb, logger, suppliers: { repo: createSupplierRepository(t.appDb), lookup } });

beforeAll(async () => {
  t = await startTestDb();
  const user = await t.pool.query("insert into users (email, password_hash) values ('owner@example.com', 'h') returning id");
  userId = user.rows[0].id;
  sid = randomBytes(32).toString("hex");
  await t.pool.query("insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [
    userId,
    createHash("sha256").update(sid).digest("hex"),
  ]);
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, audit_events cascade");
  lookedUp.length = 0;
  for (const k of Object.keys(dns)) delete dns[k];
});

type Supplier = {
  id: string;
  name: string;
  websiteUrl: string;
  loginUrl: string | null;
  checkIntervalMinutes: number;
  enabled: boolean;
  sessionStatus: string;
  pausedReason: string | null;
};
type Body = { supplier: Supplier; suppliers: Supplier[]; error: { code: string; message: string }; ok: boolean };
type Method = "GET" | "POST" | "PATCH" | "DELETE";
async function call(method: Method, url: string, payload?: unknown, cookie = true) {
  const res = await app().inject({ method, url, payload: payload as never, cookies: cookie ? { sid } : {} });
  return { status: res.statusCode, body: res.json() as Body };
}
const acme = { name: "Acme Supply", websiteUrl: "https://acme.example/" };
const create = async (body: Record<string, unknown> = acme) => {
  const r = await call("POST", "/api/suppliers", body);
  expect(r.status).toBe(201);
  return r.body.supplier;
};
const events = async (action: string) =>
  (await t.pool.query("select actor_user_id, entity_type, entity_id, details from audit_events where action = $1", [action])).rows;
const count = async () => Number((await t.pool.query("select count(*) from suppliers")).rows[0].count);
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("every supplier route needs a signed-in owner", () => {
  it.each([
    ["GET", "/api/suppliers"],
    ["POST", "/api/suppliers"],
    ["GET", `/api/suppliers/${UNKNOWN}`],
    ["PATCH", `/api/suppliers/${UNKNOWN}`],
    ["DELETE", `/api/suppliers/${UNKNOWN}`],
    ["POST", `/api/suppliers/${UNKNOWN}/pause`],
    ["POST", `/api/suppliers/${UNKNOWN}/resume`],
  ] as const)("%s %s returns 401 without a session", async (method, url) => {
    const res = await call(method, url, method === "GET" || method === "DELETE" ? undefined : {}, false);
    expect(res.status).toBe(401);
    expect(lookedUp).toHaveLength(0);
  });
});

describe("POST /api/suppliers", () => {
  it("adds a supplier with the standard check interval and writes an audit event", async () => {
    const res = await call("POST", "/api/suppliers", { ...acme, loginUrl: "https://acme.example/sign-in" });
    expect(res.status).toBe(201);
    expect(res.body.supplier).toMatchObject({
      name: "Acme Supply",
      websiteUrl: "https://acme.example/",
      loginUrl: "https://acme.example/sign-in",
      checkIntervalMinutes: 60,
      enabled: true,
      sessionStatus: "not_connected",
      pausedReason: null,
    });
    const [event] = await events("supplier.created");
    expect(event).toMatchObject({ actor_user_id: userId, entity_type: "supplier", entity_id: res.body.supplier.id, details: { name: "Acme Supply" } });
  });

  it("cleans the address it saves", async () => {
    const res = await call("POST", "/api/suppliers", { name: "Acme", websiteUrl: "  https://ACME.example#top " });
    expect(res.body.supplier.websiteUrl).toBe("https://acme.example/");
  });

  it.each([
    ["http", "http://acme.example/"],
    ["an IP address", "https://93.184.216.34/"],
    ["localhost", "https://localhost/"],
    ["a username trick", "https://acme.example@evil.example/"],
    ["an internal port", "https://acme.example:5432/"],
    ["look-alike letters", "https://аcme.example/"],
    ["nothing", ""],
  ])("refuses a website address with %s, saves nothing and does no lookup", async (_name, websiteUrl) => {
    const res = await call("POST", "/api/suppliers", { name: "Bad", websiteUrl });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_website");
    expect(res.body.error.message).toMatch(/\S/);
    expect(await count()).toBe(0);
    expect(lookedUp).toHaveLength(0);
  });

  it("refuses a name that resolves to a private address, and says so", async () => {
    dns["sneaky.example"] = ["10.0.0.7"];
    const res = await call("POST", "/api/suppliers", { name: "Sneaky", websiteUrl: "https://sneaky.example/" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "invalid_website", message: expect.stringMatching(/private or internal/) });
    expect(await count()).toBe(0);
  });

  it("refuses a name that resolves to the cloud metadata address", async () => {
    dns["meta.example"] = ["169.254.169.254"];
    expect((await call("POST", "/api/suppliers", { name: "Meta", websiteUrl: "https://meta.example/" })).status).toBe(400);
  });

  it("refuses a name that cannot be found", async () => {
    dns["ghost.example"] = new Error("ENOTFOUND");
    const res = await call("POST", "/api/suppliers", { name: "Ghost", websiteUrl: "https://ghost.example/" });
    expect(res.body.error).toMatchObject({ code: "invalid_website", message: expect.stringMatching(/could not find/) });
  });

  it("applies the same rules to the login address", async () => {
    const http = await call("POST", "/api/suppliers", { ...acme, loginUrl: "http://acme.example/login" });
    expect(http.body.error.code).toBe("invalid_login_url");
    dns["login.example"] = ["192.168.1.9"];
    const priv = await call("POST", "/api/suppliers", { ...acme, loginUrl: "https://login.example/" });
    expect(priv.body.error.code).toBe("invalid_login_url");
    expect(await count()).toBe(0);
  });

  it.each([
    ["missing", undefined],
    ["only spaces", "   "],
    ["too long", "x".repeat(101)],
    ["not text", 42],
  ])("refuses a name that is %s", async (_label, name) => {
    const res = await call("POST", "/api/suppliers", { name, websiteUrl: acme.websiteUrl });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_name");
  });

  it("refuses a second supplier with the same name in any letter case", async () => {
    await create();
    const res = await call("POST", "/api/suppliers", { name: "ACME supply", websiteUrl: "https://other.example/" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "name_taken", message: "You already have a supplier with that name." });
    expect(await count()).toBe(1);
  });

  it.each([[14], [1441], [60.5], ["60"], [0], [-15]])("refuses a check interval of %s", async (checkIntervalMinutes) => {
    const res = await call("POST", "/api/suppliers", { ...acme, checkIntervalMinutes });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_interval");
  });

  it.each([[15], [1440]])("accepts a check interval of %s", async (checkIntervalMinutes) => {
    expect((await call("POST", "/api/suppliers", { ...acme, checkIntervalMinutes })).status).toBe(201);
  });

  it("refuses fields it does not know, so a status can never be set by hand", async () => {
    const res = await call("POST", "/api/suppliers", { ...acme, sessionStatus: "connected", enabled: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
    expect(await count()).toBe(0);
  });
});

describe("GET /api/suppliers", () => {
  it("lists suppliers by name, and an empty list when there are none", async () => {
    expect((await call("GET", "/api/suppliers")).body).toEqual({ suppliers: [] });
    await create({ name: "Zed", websiteUrl: "https://zed.example/" });
    await create({ name: "alpha", websiteUrl: "https://alpha.example/" });
    const res = await call("GET", "/api/suppliers");
    expect(res.body.suppliers.map((s) => s.name)).toEqual(["alpha", "Zed"]);
  });

  it("gets one supplier, and a plain 404 for an unknown or malformed id", async () => {
    const s = await create();
    expect((await call("GET", `/api/suppliers/${s.id}`)).body.supplier.name).toBe("Acme Supply");
    for (const id of [UNKNOWN, "not-an-id"]) {
      const res = await call("GET", `/api/suppliers/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "supplier_not_found", message: "That supplier does not exist." });
    }
  });
});

describe("PATCH /api/suppliers/:id", () => {
  it("changes the fields given, leaves the rest, and records which fields changed", async () => {
    const s = await create();
    const res = await call("PATCH", `/api/suppliers/${s.id}`, { name: "Acme Ltd", checkIntervalMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.supplier).toMatchObject({ name: "Acme Ltd", websiteUrl: "https://acme.example/", checkIntervalMinutes: 30 });
    const [event] = await events("supplier.updated");
    expect(event).toMatchObject({ actor_user_id: userId, entity_id: s.id, details: { changed: ["name", "checkIntervalMinutes"] } });
  });

  it("checks a new website address like a new supplier", async () => {
    const s = await create();
    expect((await call("PATCH", `/api/suppliers/${s.id}`, { websiteUrl: "http://acme.example/" })).body.error.code).toBe("invalid_website");
    dns["new.example"] = ["127.0.0.1"];
    expect((await call("PATCH", `/api/suppliers/${s.id}`, { websiteUrl: "https://new.example/" })).status).toBe(400);
    expect((await call("GET", `/api/suppliers/${s.id}`)).body.supplier.websiteUrl).toBe("https://acme.example/");
  });

  it("clears the login address with null", async () => {
    const s = await create({ ...acme, loginUrl: "https://acme.example/login" });
    const res = await call("PATCH", `/api/suppliers/${s.id}`, { loginUrl: null });
    expect(res.body.supplier.loginUrl).toBeNull();
  });

  it("refuses an empty change, an unknown field and a name already taken", async () => {
    const s = await create();
    await create({ name: "Globex", websiteUrl: "https://globex.example/" });
    expect((await call("PATCH", `/api/suppliers/${s.id}`, {})).status).toBe(400);
    expect((await call("PATCH", `/api/suppliers/${s.id}`, { enabled: false })).body.error.code).toBe("invalid_input");
    const taken = await call("PATCH", `/api/suppliers/${s.id}`, { name: "globex" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("name_taken");
  });

  it("gives a plain 404 for an unknown supplier", async () => {
    const res = await call("PATCH", `/api/suppliers/${UNKNOWN}`, { name: "x" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("supplier_not_found");
  });
});

describe("pause, resume and delete", () => {
  it("pausing one supplier changes no other, and is audited", async () => {
    const a = await create();
    const g = await create({ name: "Globex", websiteUrl: "https://globex.example/" });
    const res = await call("POST", `/api/suppliers/${a.id}/pause`);
    expect(res.body.supplier).toMatchObject({ enabled: false, pausedReason: "owner" });
    expect((await call("GET", `/api/suppliers/${g.id}`)).body.supplier).toMatchObject({ enabled: true, pausedReason: null });
    expect(await events("supplier.paused")).toEqual([expect.objectContaining({ actor_user_id: userId, entity_id: a.id })]);
  });

  it("resuming clears the pause and is audited", async () => {
    const a = await create();
    await call("POST", `/api/suppliers/${a.id}/pause`);
    const res = await call("POST", `/api/suppliers/${a.id}/resume`);
    expect(res.body.supplier).toMatchObject({ enabled: true, pausedReason: null });
    expect(await events("supplier.resumed")).toHaveLength(1);
  });

  it("gives a plain 404 pausing or resuming an unknown supplier, with no audit event", async () => {
    expect((await call("POST", `/api/suppliers/${UNKNOWN}/pause`)).status).toBe(404);
    expect((await call("POST", `/api/suppliers/${UNKNOWN}/resume`)).status).toBe(404);
    expect(await events("supplier.paused")).toHaveLength(0);
  });

  it("deletes a supplier, audits it, and gives 404 the second time", async () => {
    const a = await create();
    expect((await call("DELETE", `/api/suppliers/${a.id}`)).body).toEqual({ ok: true });
    expect(await count()).toBe(0);
    expect(await events("supplier.deleted")).toEqual([expect.objectContaining({ entity_id: a.id, details: { name: "Acme Supply" } })]);
    expect((await call("DELETE", `/api/suppliers/${a.id}`)).status).toBe(404);
  });
});
