import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createAuditWriter } from "../src/index.js";

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

describe("audit writer", () => {
  it("stores an event with actor, action, entity and request id", async () => {
    const audit = createAuditWriter(t.appDb);
    const actor = "7f1f6f0e-9d1c-4c55-8d2b-3a1d7a3d1111";
    await audit.record({
      actorUserId: actor,
      action: "login.succeeded",
      entityType: "user",
      entityId: "u-1",
      requestId: "req-1",
    });
    const { rows } = await t.pool.query("select * from audit_events where request_id = 'req-1'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: actor,
      action: "login.succeeded",
      entity_type: "user",
      entity_id: "u-1",
    });
  });

  it("strips secret-like keys from details", async () => {
    const audit = createAuditWriter(t.appDb);
    await audit.record({
      action: "supplier.connected",
      entityType: "supplier",
      requestId: "req-2",
      details: { supplier: "acme", cookie: "SESSION-COOKIE-x", nested: { password: "PW-x" } },
    });
    const { rows } = await t.pool.query("select details from audit_events where request_id = 'req-2'");
    const text = JSON.stringify(rows[0].details);
    expect(text).toContain("acme");
    expect(text).not.toContain("SESSION-COOKIE-x");
    expect(text).not.toContain("PW-x");
  });
});

describe("audit table protection (as the app role)", () => {
  it("allows the app role to read what it wrote", async () => {
    const { rows } = await t.appPool.query("select count(*)::int as n from audit_events");
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("rejects UPDATE on audit_events", async () => {
    await expect(t.appPool.query("update audit_events set action = 'tampered'")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("rejects DELETE on audit_events", async () => {
    await expect(t.appPool.query("delete from audit_events")).rejects.toThrow(/permission denied/i);
  });

  it("rejects TRUNCATE on audit_events", async () => {
    await expect(t.appPool.query("truncate audit_events")).rejects.toThrow(/permission denied/i);
  });

  it("still lets the app role use the other tables", async () => {
    await t.appPool.query("insert into users (email, password_hash) values ('app@x.com', 'h')");
    await t.appPool.query("update users set password_hash = 'h2' where email = 'app@x.com'");
    const { rows } = await t.appPool.query("select 1 from users where email = 'app@x.com'");
    expect(rows).toHaveLength(1);
  });
});
