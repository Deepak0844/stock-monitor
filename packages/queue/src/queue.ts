import { PgBoss } from "pg-boss";
import { jobSchemas, parseJob, type JobName, type JobPayload } from "./jobs.js";

export type Queue = {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue<N extends JobName>(name: N, payload: JobPayload<N>): Promise<void>;
  work<N extends JobName>(name: N, handler: (payload: JobPayload<N>) => Promise<void>): Promise<void>;
};

export function createQueue(opts: {
  connectionString: string;
  onError?: (error: Error) => void;
}): Queue {
  const boss = new PgBoss(opts.connectionString);
  // pg-boss emits 'error' events. Without a listener Node would crash the process.
  boss.on("error", opts.onError ?? (() => {}));

  return {
    async start() {
      await boss.start();
      for (const name of Object.keys(jobSchemas)) await boss.createQueue(name);
    },
    async stop() {
      await boss.stop({ graceful: true });
    },
    async enqueue(name, payload) {
      await boss.send(name, parseJob(name, payload));
    },
    async work(name, handler) {
      await boss.work(name, async (jobs) => {
        for (const job of jobs) await handler(parseJob(name, job.data));
      });
    },
  };
}
