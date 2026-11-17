import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createSupplierCredentialsRepository, createSupplierRepository } from "@stock-monitor/db";
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
const queued: { name: string; payload: unknown }[] = [];
const queue = { enqueue: async (name: string, payload: unknown) => void queued.push({ name, payload }) };
const key = { key: randomBytes(32), keyId: "test-key" };
const supplierDeps = (db = t.appDb) => ({
  repo: createSupplierRepository(db),
  lookup,
  credentials: createSupplierCredentialsRepository(db),
  key,
  queue: queue as never,
});
const app = (log = logger) => buildApp({ db: t.appDb, logger: log, suppliers: supplierDeps() });

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
  queued.length = 0;
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
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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
    ["PUT", `/api/suppliers/${UNKNOWN}/credentials`],
    ["DELETE", `/api/suppliers/${UNKNOWN}/credentials`],
    ["POST", `/api/suppliers/${UNKNOWN}/auto-login/test`],
    ["POST", `/api/suppliers/${UNKNOWN}/auto-login/resume`],
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

describe("GET /api/suppliers with a page", () => {
  type Paged = { items: Supplier[]; total: number; page: number; pageSize: number };
  const seed = async (n: number) => {
    for (let i = 1; i <= n; i++) await create({ name: `Supplier ${String(i).padStart(2, "0")}`, websiteUrl: `https://s${i}.example/` });
  };

  it("returns one page with the total, and still lists everything when no page is asked for", async () => {
    await seed(12);
    const paged = (await call("GET", "/api/suppliers?page=2&pageSize=5")).body as unknown as Paged;
    expect(paged).toMatchObject({ total: 12, page: 2, pageSize: 5 });
    expect(paged.items.map((s) => s.name)).toEqual(["Supplier 06", "Supplier 07", "Supplier 08", "Supplier 09", "Supplier 10"]);
    expect((await call("GET", "/api/suppliers")).body.suppliers).toHaveLength(12);
  });

  it("filters by search and status", async () => {
    await seed(3);
    const found = (await call("GET", "/api/suppliers?page=1&pageSize=10&search=supplier%2002")).body as unknown as Paged;
    expect(found.items.map((s) => s.name)).toEqual(["Supplier 02"]);
    const none = (await call("GET", "/api/suppliers?page=1&pageSize=10&status=paused")).body as unknown as Paged;
    expect(none.total).toBe(0);
  });

  it.each(["page=0", "page=abc", "page=1&pageSize=0", "page=1&pageSize=101", "page=1&pageSize=-5", "page=1&status=nonsense"])(
    "refuses ?%s with a plain 400",
    async (query) => {
      const res = await call("GET", `/api/suppliers?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_input");
    },
  );
});

describe("automatic login", () => {
  const SECRET = "hunter2-very-secret";
  const creds = { username: "buyer@acme.example", password: SECRET };
  const grant = (id: string) => createSupplierRepository(t.appDb).setPermission(id, { status: "granted", note: null });
  type Full = Supplier & { autoLogin: boolean; stealth: boolean; credentialsSavedAt: string | null; autoLoginPausedReason: string | null; lastAutoLoginAt: string | null; lastAutoLoginResult: string | null; loggedInMarker: string | null };
  const get = async (id: string) => (await call("GET", `/api/suppliers/${id}`)).body.supplier as Full;

  it("saves credentials and never returns, stores in clear or audits the password", async () => {
    const s = await create();
    const res = await app().inject({ method: "PUT", url: `/api/suppliers/${s.id}/credentials`, payload: creds, cookies: { sid } });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json())).toEqual(["savedAt"]);
    expect(res.body).not.toContain(SECRET);
    const got = await call("GET", `/api/suppliers/${s.id}`);
    expect(JSON.stringify(got.body)).not.toContain(SECRET);
    expect((await get(s.id)).credentialsSavedAt).toEqual(expect.any(String));
    const audit = await t.pool.query("select * from audit_events");
    expect(JSON.stringify(audit.rows)).not.toContain(SECRET);
    const [event] = await events("supplier.credentials_saved");
    expect(event).toMatchObject({ entity_id: s.id });
    const row = await t.pool.query("select ciphertext from supplier_credentials");
    expect(JSON.stringify(row.rows)).not.toContain(SECRET);
  });

  it.each([
    ["a 201-character password", { username: "u", password: "x".repeat(201) }],
    ["an empty username", { username: "", password: "p" }],
    ["a missing password", { username: "u" }],
    ["an empty account", { username: "u", password: "p", account: "" }],
  ])("refuses %s", async (_n, body) => {
    const s = await create();
    expect((await call("PUT", `/api/suppliers/${s.id}/credentials`, body)).status).toBe(400);
  });

  it("returns 404 for an unknown supplier", async () => {
    expect((await call("PUT", `/api/suppliers/${UNKNOWN}/credentials`, creds)).status).toBe(404);
  });

  it("refuses to turn automatic login on without credentials, then without permission, then allows it", async () => {
    const s = await create();
    const first = await call("PATCH", `/api/suppliers/${s.id}`, { autoLogin: true });
    expect(first.status).toBe(409);
    expect(first.body.error).toMatchObject({ code: "no_credentials", message: "Save a username and password first." });
    await call("PUT", `/api/suppliers/${s.id}/credentials`, creds);
    const second = await call("PATCH", `/api/suppliers/${s.id}`, { autoLogin: true });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: "not_granted", message: "Mark this supplier as allowing automatic checks first." });
    await grant(s.id);
    const third = await call("PATCH", `/api/suppliers/${s.id}`, { autoLogin: true });
    expect(third.status).toBe(200);
    expect(third.body.supplier).toMatchObject({ autoLogin: true, credentialsSavedAt: expect.any(String) });
  });

  it("changes nothing when a refused automatic login comes with other fields", async () => {
    const s = await create();
    const res = await call("PATCH", `/api/suppliers/${s.id}`, { name: "Renamed", autoLogin: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("no_credentials");
    expect((await get(s.id)).name).toBe("Acme Supply");
  });

  it("saves login selectors and rejects bad ones", async () => {
    const s = await create();
    const bad = await call("PATCH", `/api/suppliers/${s.id}`, { loginSelectors: { nope: 1 } });
    expect(bad.status).toBe(400);
    const none = await call("PATCH", `/api/suppliers/${s.id}`, { loginSelectors: null });
    expect(none.status).toBe(200);
  });

  it("saves the logged-in marker, returns it, and clears it with null", async () => {
    const s = await create();
    expect((await get(s.id)).loggedInMarker).toBeNull();
    const saved = await call("PATCH", `/api/suppliers/${s.id}`, { loggedInMarker: "Log out" });
    expect(saved.status).toBe(200);
    expect(saved.body.supplier).toMatchObject({ loggedInMarker: "Log out" });
    expect((await get(s.id)).loggedInMarker).toBe("Log out");
    const cleared = await call("PATCH", `/api/suppliers/${s.id}`, { loggedInMarker: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.supplier).toMatchObject({ loggedInMarker: null });
  });

  it("saves the logged-in marker without the spaces around it, since a page's text is matched without them", async () => {
    const s = await create();
    const saved = await call("PATCH", `/api/suppliers/${s.id}`, { loggedInMarker: "  Log out \n" });
    expect(saved.status).toBe(200);
    expect(saved.body.supplier).toMatchObject({ loggedInMarker: "Log out" });
    expect((await get(s.id)).loggedInMarker).toBe("Log out");
  });

  it.each([
    ["201 characters", "m".repeat(201)],
    ["an empty marker", ""],
    ["only spaces", "   "],
    ["only a tab and a new line", "\t\n"],
    ["a number", 7],
  ])("refuses a logged-in marker of %s and changes nothing", async (_n, loggedInMarker) => {
    const s = await create();
    const res = await call("PATCH", `/api/suppliers/${s.id}`, { name: "Renamed", loggedInMarker });
    expect(res.status).toBe(400);
    expect(await get(s.id)).toMatchObject({ name: "Acme Supply", loggedInMarker: null });
  });

  it("turns automatic login off when permission is revoked", async () => {
    const s = await create();
    await call("PUT", `/api/suppliers/${s.id}/credentials`, creds);
    await grant(s.id);
    await call("PATCH", `/api/suppliers/${s.id}`, { autoLogin: true });
    expect((await get(s.id)).autoLogin).toBe(true);
    await createSupplierRepository(t.appDb).setPermission(s.id, { status: "not_granted", note: null });
    expect((await get(s.id)).autoLogin).toBe(false);
  });

  it("removing credentials switches automatic login off and audits it", async () => {
    const s = await create();
    await call("PUT", `/api/suppliers/${s.id}/credentials`, creds);
    await grant(s.id);
    await call("PATCH", `/api/suppliers/${s.id}`, { autoLogin: true });
    const res = await app().inject({ method: "DELETE", url: `/api/suppliers/${s.id}/credentials`, cookies: { sid } });
    expect(res.statusCode).toBe(204);
    const after = await get(s.id);
    expect(after).toMatchObject({ autoLogin: false, credentialsSavedAt: null });
    expect(await events("supplier.credentials_removed")).toHaveLength(1);
  });

  it("queues one test login and limits it to one a minute per supplier", async () => {
    const s = await create();
    const other = await create({ name: "Other", websiteUrl: "https://other.example/" });
    const a = app();
    const post = (id: string) => a.inject({ method: "POST", url: `/api/suppliers/${id}/auto-login/test`, cookies: { sid } });
    expect((await post(s.id)).statusCode).toBe(202);
    expect(queued).toEqual([{ name: "supplier.session.login", payload: { supplierId: s.id } }]);
    expect((await post(s.id)).statusCode).toBe(429);
    expect(queued).toHaveLength(1);
    expect((await post(other.id)).statusCode).toBe(202);
  });

  it("resume clears the pause", async () => {
    const s = await create();
    await t.pool.query("update suppliers set auto_login_failures = 2, auto_login_paused_reason = 'too_many_failures' where id = $1", [s.id]);
    expect((await get(s.id)).autoLoginPausedReason).toBe("too_many_failures");
    const res = await app().inject({ method: "POST", url: `/api/suppliers/${s.id}/auto-login/resume`, cookies: { sid } });
    expect(res.statusCode).toBe(204);
    expect((await get(s.id)).autoLoginPausedReason).toBeNull();
  });

  it("never writes the username or password to the log", async () => {
    const lines: string[] = [];
    const logged = createLogger({ level: "trace", stream: new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) }) });
    const s = await create();
    const res = await app(logged).inject({ method: "PUT", url: `/api/suppliers/${s.id}/credentials`, payload: creds, cookies: { sid } });
    expect(res.statusCode).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("")).not.toContain(SECRET);
    expect(lines.join("")).not.toContain(creds.username);
  });
});
