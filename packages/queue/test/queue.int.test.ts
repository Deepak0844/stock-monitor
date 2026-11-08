import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createQueue, type Queue } from "../src/index.js";

let t: TestDb;
let queue: Queue;

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterEach(async () => {
  await queue?.stop();
});
afterAll(async () => {
  await t?.stop();
});

const started = async () => {
  queue = createQueue({ connectionString: t.appUrl });
  await queue.start();
  return queue;
};

describe("queue", () => {
  it("runs the handler with the validated payload when a job is enqueued", async () => {
    const q = await started();
    const received = new Promise<{ message: string }>((resolve) => {
      void q.work("health.ping", async (payload) => resolve(payload));
    });
    await q.enqueue("health.ping", { message: "hello from test" });
    expect(await received).toEqual({ message: "hello from test" });
  }, 30_000);

  it("rejects an invalid payload when enqueuing and queues nothing", async () => {
    const q = await started();
    await expect(q.enqueue("health.ping", { message: 5 } as never)).rejects.toThrow(/health\.ping/);
    const { rows } = await t.pool.query(
      "select count(*)::int as n from pgboss.job where name = 'health.ping' and data->>'message' = '5'",
    );
    expect(rows[0].n).toBe(0);
  });

  it("can start twice against the same database", async () => {
    const q1 = await started();
    await q1.stop();
    const q2 = await started();
    await expect(q2.enqueue("health.ping", { message: "again" })).resolves.toBeUndefined();
  }, 30_000);
});
