import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

describe("schema", () => {
  it("creates the foundation tables from an empty database", async () => {
    const { rows } = await t.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(["users", "app_sessions", "audit_events", "app_settings"]),
    );
  });

  it("rejects a second user with the same email", async () => {
    await t.pool.query("insert into users (email, password_hash) values ('a@x.com', 'h')");
    await expect(
      t.pool.query("insert into users (email, password_hash) values ('a@x.com', 'h2')"),
    ).rejects.toThrow(/unique/i);
  });

  it("deletes a user's sessions when the user is deleted", async () => {
    const u = await t.pool.query(
      "insert into users (email, password_hash) values ('b@x.com', 'h') returning id",
    );
    await t.pool.query(
      "insert into app_sessions (user_id, token_hash, expires_at) values ($1, 'th', now() + interval '1 day')",
      [u.rows[0].id],
    );
    await t.pool.query("delete from users where id = $1", [u.rows[0].id]);
    const { rows } = await t.pool.query("select 1 from app_sessions where token_hash = 'th'");
    expect(rows).toHaveLength(0);
  });

  it("stores audit events with defaults for time and details", async () => {
    await t.pool.query("insert into audit_events (action, entity_type) values ('test', 'thing')");
    const { rows } = await t.pool.query("select at, details from audit_events limit 1");
    expect(rows[0].at).toBeInstanceOf(Date);
    expect(rows[0].details).toEqual({});
  });
});
