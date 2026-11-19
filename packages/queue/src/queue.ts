import { PgBoss } from "pg-boss";
import { jobSchemas, parseJob, type JobName, type JobPayload } from "./jobs.js";

/** For a job that runs long: how many seconds it may run before the queue gives up on it, and how often it is tried again. */
export type JobOptions = {
  expireInSeconds?: number;
  retryLimit?: number;
  /** Do not start the job until this many seconds from now. */
  startAfter?: number;
  /**
   * Group repeated sends of this job into slots this many seconds long: the first send runs now, and every further
   * send in the same slot folds into one job in the next slot. However many arrive, at most two wait.
   */
  groupSeconds?: number;
};

export type Queue = {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue<N extends JobName>(name: N, payload: JobPayload<N>, options?: JobOptions): Promise<void>;
  /** Runs the job on a cron schedule (one schedule per job name, however often this is called). */
  schedule(name: JobName, cron: string): Promise<void>;
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
    async enqueue(name, payload, options) {
      const { groupSeconds, ...rest } = options ?? {};
      if (groupSeconds) await boss.sendDebounced(name, parseJob(name, payload), rest, groupSeconds, name);
      else await boss.send(name, parseJob(name, payload), rest);
    },
    async schedule(name, cron) {
      await boss.schedule(name, cron, {});
    },
    async work(name, handler) {
      await boss.work(name, async (jobs) => {
        for (const job of jobs) await handler(parseJob(name, job.data));
      });
    },
  };
}
