/** How many jobs may wait behind the running one before new ones are refused. */
export const MAX_WAITING = 8;

/** The queue is full: the caller is told "busy" at once instead of waiting. */
export class QueueFullError extends Error {
  override name = "QueueFullError";
}
/** The caller went away before the job's turn: the job was never run. */
export class AbandonedError extends Error {
  override name = "AbandonedError";
}

type Waiter = { start: () => void; drop: () => void; signal?: AbortSignal; onAbort?: () => void };

/**
 * Runs jobs one at a time. Urgent jobs (a person is waiting) go before ordinary ones (scheduled checks), each lane first come first
 * served. A running job is never interrupted. A waiting job whose caller has gone is dropped without running. At most `maxWaiting`
 * jobs wait in each lane, so a pile of scheduled checks never turns away a person; the running one does not count.
 */
export function createJobQueue({ maxWaiting = MAX_WAITING }: { maxWaiting?: number } = {}) {
  const urgentLane: Waiter[] = [];
  const ordinaryLane: Waiter[] = [];
  let running = false;

  const next = () => {
    const waiter = urgentLane.shift() ?? ordinaryLane.shift();
    if (!waiter) {
      running = false;
      return;
    }
    waiter.signal?.removeEventListener("abort", waiter.onAbort as () => void);
    waiter.start();
  };

  function run<T>(job: () => Promise<T>, { urgent = false, signal }: { urgent?: boolean; signal?: AbortSignal } = {}): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AbandonedError());
    const execute = async (): Promise<T> => {
      try {
        return await job();
      } finally {
        next();
      }
    };
    if (!running) {
      running = true;
      return execute();
    }
    const lane = urgent ? urgentLane : ordinaryLane;
    if (lane.length >= maxWaiting) return Promise.reject(new QueueFullError());
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        start: () => execute().then(resolve, reject),
        drop: () => reject(new AbandonedError()),
      };
      waiter.onAbort = () => {
        const at = lane.indexOf(waiter);
        if (at >= 0) lane.splice(at, 1);
        waiter.drop();
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      lane.push(waiter);
    });
  }

  return { run };
}
