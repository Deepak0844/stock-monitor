import { useCallback, useEffect, useRef } from "react";

export const WATCH_MS = 3000;

/**
 * Follows one check by asking a small status every few seconds. Resolves true once `done` says the check has finished, or false
 * when `times` reads have gone by or a read failed. Each key has its own timer, so checks of different rows never cancel each
 * other. All stop when the page goes.
 */
export function useWatch() {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);
  return useCallback(
    <T>(key: string, times: number, read: () => Promise<T>, done: (status: T) => boolean): Promise<boolean> =>
      new Promise((resolve) => {
        const finish = (ok: boolean) => {
          timers.current.delete(key);
          resolve(ok);
        };
        const next = (left: number) =>
          timers.current.set(
            key,
            setTimeout(() => {
              read()
                .then((status) => (done(status) ? finish(true) : left > 1 ? next(left - 1) : finish(false)))
                .catch(() => finish(false));
            }, WATCH_MS),
          );
        clearTimeout(timers.current.get(key));
        next(times);
      }),
    [],
  );
}
