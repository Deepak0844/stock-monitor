import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import type { Queue } from "@stock-monitor/queue";
import { createLogger } from "@stock-monitor/shared";
import { registerHandlers, type WorkerDeps } from "./worker.js";

const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });

function fakeQueue(enqueueFails = false) {
  const handlers = new Map<string, (payload: never) => Promise<void>>();
  const enqueued: { name: string; payload: unknown }[] = [];
  const queue = {
    work: async (name: string, handler: (payload: never) => Promise<void>) => void handlers.set(name, handler),
    enqueue: async (name: string, payload: unknown) => {
      if (enqueueFails) throw new Error("queue down");
      enqueued.push({ name, payload });
    },
    schedule: async () => {},
  } as unknown as Queue;
  return { queue, handlers, enqueued };
}

const syncRepo = { startSyncRun: async () => 1, getCredentials: async () => null, finishSyncRun: async () => {} } as never;
const evaluate = {
  mappings: {} as never, observations: {} as never, shopify: {} as never, proposals: {} as never,
};
const deps = (): WorkerDeps => ({ shopify: { repo: syncRepo }, proposals: evaluate });

describe("suggestions are evaluated after the data they depend on changes", () => {
  it("registers the evaluate job only when suggestions are set up", async () => {
    const a = fakeQueue();
    await registerHandlers(a.queue, logger, { shopify: { repo: syncRepo } });
    expect(a.handlers.has("proposals.evaluate")).toBe(false);
    const b = fakeQueue();
    await registerHandlers(b.queue, logger, deps());
    expect(b.handlers.has("proposals.evaluate")).toBe(true);
  });

  it("registers the apply job only when the Shopify write is set up", async () => {
    const a = fakeQueue();
    await registerHandlers(a.queue, logger, deps());
    expect(a.handlers.has("proposals.apply")).toBe(false);
    const b = fakeQueue();
    await registerHandlers(b.queue, logger, { proposalsApply: { proposals: {} as never, shopify: {} as never, audit: {} as never, notifications: {} as never, queue: b.queue } });
    expect(b.handlers.has("proposals.apply")).toBe(true);
  });

  it("queues one evaluation for every link after a Shopify sync, with no data", async () => {
    const q = fakeQueue();
    await registerHandlers(q.queue, logger, deps());
    await q.handlers.get("shopify.sync")!({} as never);
    expect(q.enqueued).toEqual([{ name: "proposals.evaluate", payload: {} }]);
  });

  it("a queue that is down never fails the job that finished", async () => {
    const q = fakeQueue(true);
    await registerHandlers(q.queue, logger, deps());
    await expect(q.handlers.get("shopify.sync")!({} as never)).resolves.toBeUndefined();
  });
});
