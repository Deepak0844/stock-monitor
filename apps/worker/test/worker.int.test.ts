import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { randomBytes } from "node:crypto";
import { createCheckRunRepository, createMappingRepository, createNotificationRepository, createSupplierCredentialsRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient } from "@stock-monitor/browser-client";
import { createQueue, type Queue } from "@stock-monitor/queue";
import { createLogger } from "@stock-monitor/shared";
import { registerHandlers } from "../src/worker.js";

let t: TestDb;
let queue: Queue;
beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await queue?.stop();
  await t?.stop();
});

describe("worker", () => {
  it("processes a health.ping job and logs it", async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      stream: new Writable({
        write(chunk, _e, cb) {
          lines.push(chunk.toString());
          cb();
        },
      }),
    });
    queue = createQueue({ connectionString: t.appUrl });
    await queue.start();
    await registerHandlers(queue, logger);
    await queue.enqueue("health.ping", { message: "ping-from-worker-test" });

    await expect
      .poll(() => lines.join(""), { timeout: 20_000 })
      .toContain("ping-from-worker-test");
  }, 40_000);

  it("handles a supplier.session.login job: a supplier that is gone is refused without a login", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", stream: new Writable({ write: (chunk, _e, cb) => (lines.push(chunk.toString()), cb()) }) });
    let logins = 0;
    const browser = { login: async () => (logins++, { ok: false, reason: "unreachable" }) } as unknown as BrowserClient;
    const q = createQueue({ connectionString: t.appUrl });
    await q.start();
    try {
      await registerHandlers(q, logger, {
        autoLoginTest: {
          suppliers: createSupplierRepository(t.appDb), supplierSessions: createSupplierSessionRepository(t.appDb), supplierCredentials: createSupplierCredentialsRepository(t.appDb),
          notifications: createNotificationRepository(t.appDb), audit: createAuditWriter(t.appDb), checkRuns: createCheckRunRepository(t.appDb), mappings: createMappingRepository(t.appDb),
          browser, key: randomBytes(32), timezone: "UTC",
        },
      });
      await q.enqueue("supplier.session.login", { supplierId: "00000000-0000-4000-8000-000000000000" });
      await expect.poll(() => lines.join(""), { timeout: 20_000 }).toContain("no_supplier");
      expect(logins).toBe(0);
    } finally {
      await q.stop();
    }
  }, 40_000);
});
