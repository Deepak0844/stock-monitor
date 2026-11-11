import { describe, expect, it } from "vitest";
import { AbandonedError, createJobQueue, QueueFullError } from "./job-queue.js";

/** A job that records when it starts and finishes only when released. */
function makeJob(name: string, log: string[]) {
  let release!: (value?: string) => void;
  let fail!: (error: Error) => void;
  const gate = new Promise<string>((resolve, reject) => {
    release = (v = name) => resolve(v);
    fail = reject;
  });
  const job = async () => {
    log.push(`start ${name}`);
    const r = await gate;
    log.push(`end ${name}`);
    return r;
  };
  return { job, release, fail };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createJobQueue", () => {
  it("runs one job at a time, first come first served", async () => {
    const log: string[] = [];
    const q = createJobQueue();
    const a = makeJob("a", log), b = makeJob("b", log), c = makeJob("c", log);
    const pa = q.run(a.job), pb = q.run(b.job), pc = q.run(c.job);
    await tick();
    expect(log).toEqual(["start a"]);
    a.release();
    await pa;
    await tick();
    expect(log).toEqual(["start a", "end a", "start b"]);
    b.release();
    await pb;
    await tick();
    c.release();
    await pc;
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("an urgent job waits for the running job but goes ahead of waiting ordinary jobs", async () => {
    const log: string[] = [];
    const q = createJobQueue();
    const [a, b, c, d] = ["a", "b", "c", "d"].map((n) => makeJob(n, log));
    const all = [q.run(a.job), q.run(b.job), q.run(c.job)];
    await tick();
    all.push(q.run(d.job, { urgent: true }));
    await tick();
    expect(log).toEqual(["start a"]);
    for (const j of [a, d, b, c]) {
      j.release();
      await tick();
      await tick();
    }
    await Promise.all(all);
    expect(log.filter((l) => l.startsWith("start"))).toEqual(["start a", "start d", "start b", "start c"]);
  });

  it("urgent jobs keep their own order", async () => {
    const log: string[] = [];
    const q = createJobQueue();
    const [a, u1, u2] = ["a", "u1", "u2"].map((n) => makeJob(n, log));
    const all = [q.run(a.job), q.run(u1.job, { urgent: true }), q.run(u2.job, { urgent: true })];
    for (const j of [a, u1, u2]) {
      await tick();
      j.release();
      await tick();
    }
    await Promise.all(all);
    expect(log.filter((l) => l.startsWith("start"))).toEqual(["start a", "start u1", "start u2"]);
  });

  it("skips a waiting job whose caller has gone, and rejects its promise with AbandonedError", async () => {
    const log: string[] = [];
    const q = createJobQueue();
    const [a, b, c] = ["a", "b", "c"].map((n) => makeJob(n, log));
    const gone = new AbortController();
    const pa = q.run(a.job);
    const pb = q.run(b.job, { signal: gone.signal });
    const pc = q.run(c.job);
    const rejected = expect(pb).rejects.toBeInstanceOf(AbandonedError);
    await tick();
    gone.abort();
    await rejected;
    a.release();
    await pa;
    await tick();
    c.release();
    await pc;
    expect(log).not.toContain("start b");
    expect(log).toContain("end c");
  });

  it("a job that is already running finishes when its caller goes", async () => {
    const log: string[] = [];
    const q = createJobQueue();
    const a = makeJob("a", log);
    const gone = new AbortController();
    const pa = q.run(a.job, { signal: gone.signal });
    await tick();
    gone.abort();
    a.release();
    await expect(pa).resolves.toBe("a");
  });

  it("refuses a job when maxWaiting jobs are already waiting, with QueueFullError, at once", async () => {
    const log: string[] = [];
    const q = createJobQueue({ maxWaiting: 2 });
    const [a, b, c] = ["a", "b", "c"].map((n) => makeJob(n, log));
    const pa = q.run(a.job); // running, not waiting
    const pb = q.run(b.job);
    const pc = q.run(c.job);
    await tick();
    await expect(q.run(async () => "x")).rejects.toBeInstanceOf(QueueFullError);
    for (const j of [a, b, c]) {
      j.release();
      await tick();
      await tick();
    }
    await expect(Promise.all([pa, pb, pc])).resolves.toEqual(["a", "b", "c"]);
  });

  it("a job that throws does not block the next job", async () => {
    const log: string[] = [];
    const q = createJobQueue();
    const a = makeJob("a", log), b = makeJob("b", log);
    const pa = q.run(a.job);
    const pb = q.run(b.job);
    const failed = expect(pa).rejects.toThrow("boom");
    await tick();
    a.fail(new Error("boom"));
    await failed;
    await tick();
    b.release();
    await expect(pb).resolves.toBe("b");
  });

  it("a signal already aborted when run is called rejects with AbandonedError without queueing", async () => {
    const q = createJobQueue();
    const gone = new AbortController();
    gone.abort();
    let ran = false;
    await expect(q.run(async () => { ran = true; }, { signal: gone.signal })).rejects.toBeInstanceOf(AbandonedError);
    expect(ran).toBe(false);
  });

  it("a full ordinary lane does not turn away an urgent job", async () => {
    const log: string[] = [];
    const q = createJobQueue({ maxWaiting: 2 });
    const [a, b, c, u] = ["a", "b", "c", "u"].map((n) => makeJob(n, log));
    const all = [q.run(a.job), q.run(b.job), q.run(c.job)];
    await tick();
    await expect(q.run(async () => "x")).rejects.toBeInstanceOf(QueueFullError); // ordinary lane is full
    all.push(q.run(u.job, { urgent: true })); // a person is still let in
    for (const j of [a, u, b, c]) {
      j.release();
      await tick();
      await tick();
    }
    await Promise.all(all);
    expect(log.filter((l) => l.startsWith("start"))).toEqual(["start a", "start u", "start b", "start c"]);
  });

  it("a waiting job that has started and then loses its caller still finishes", async () => {
    const log: string[] = [];
    const q = createJobQueue();
    const a = makeJob("a", log), b = makeJob("b", log);
    const gone = new AbortController();
    const pa = q.run(a.job);
    const pb = q.run(b.job, { signal: gone.signal });
    await tick();
    a.release();
    await pa;
    await tick();
    expect(log).toContain("start b");
    gone.abort();
    b.release();
    await expect(pb).resolves.toBe("b");
  });

  it("aborted waiters stop counting toward the limit", async () => {
    const log: string[] = [];
    const q = createJobQueue({ maxWaiting: 1 });
    const a = makeJob("a", log), b = makeJob("b", log);
    const gone = new AbortController();
    const pa = q.run(a.job);
    const dropped = q.run(async () => "x", { signal: gone.signal });
    const rejected = expect(dropped).rejects.toBeInstanceOf(AbandonedError);
    await tick();
    gone.abort();
    await rejected;
    const pb = q.run(b.job); // accepted: the dropped waiter no longer takes the place
    a.release();
    await pa;
    await tick();
    b.release();
    await expect(pb).resolves.toBe("b");
  });
});
