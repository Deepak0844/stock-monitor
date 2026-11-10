import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { startPostgres, type RunningPostgres } from "./harness.js";
import { setupDatabase } from "../src/setup.js";

let pgc: RunningPostgres;
beforeAll(async () => {
  pgc = await startPostgres();
}, 180_000);
afterAll(async () => {
  await pgc?.stop();
});

const asApp = (password: string) => {
  const url = new URL(pgc.url);
  url.username = "stock_app";
  url.password = password;
  return new pg.Pool({ connectionString: url.toString() });
};

describe("setupDatabase", () => {
  it("applies migrations and creates a login role that is restricted on the audit log", async () => {
    await setupDatabase({ ownerUrl: pgc.url, appRole: "stock_app", appPassword: "first-pass-123" });
    const app = asApp("first-pass-123");
    try {
      await app.query("insert into audit_events (action, entity_type) values ('t', 't')");
      await expect(app.query("delete from audit_events")).rejects.toThrow(/permission denied/i);
      await expect(app.query("update audit_events set action = 'x'")).rejects.toThrow(/permission denied/i);
    } finally {
      await app.end();
    }
  });

  it("can run again, and applies a changed password", async () => {
    await setupDatabase({ ownerUrl: pgc.url, appRole: "stock_app", appPassword: "second-pass-456" });
    const app = asApp("second-pass-456");
    try {
      await expect(app.query("select 1")).resolves.toBeDefined();
    } finally {
      await app.end();
    }
    await expect(asApp("first-pass-123").query("select 1")).rejects.toThrow(/password authentication failed/i);
  });

  it("handles a password containing quotes safely", async () => {
    const tricky = "p'a\"ss;--drop table users";
    await setupDatabase({ ownerUrl: pgc.url, appRole: "stock_app", appPassword: tricky });
    const url = new URL(pgc.url);
    const pool = new pg.Pool({ host: url.hostname, port: Number(url.port), user: "stock_app", password: tricky, database: url.pathname.slice(1) });
    try {
      await expect(pool.query("select 1")).resolves.toBeDefined();
    } finally {
      await pool.end();
    }
  });

  it("rejects an unsafe role name", async () => {
    await expect(
      setupDatabase({ ownerUrl: pgc.url, appRole: 'x"; drop role stock_app; --', appPassword: "pw-pw-pw-pw" }),
    ).rejects.toThrow(/role name/i);
  });
});
