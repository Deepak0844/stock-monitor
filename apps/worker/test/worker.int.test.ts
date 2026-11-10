import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
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
});
