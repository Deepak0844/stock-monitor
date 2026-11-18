import { useCallback, useEffect, useRef } from "react";

const WATCH_MS = 3000;

/**
 * Follows one check by asking for that one item again every few seconds and handing each read to `show`, until `done` says
 * its answer has shown or `times` reads have gone by. Each key has its own timer, so checks of different rows never cancel each other. All stop when the page goes.
 */
export function useWatch() {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);
  return useCallback(<T>(key: string, times: number, read: () => Promise<T>, done: (item: T) => boolean, show: (item: T) => void, onEnd: () => void) => {
    const end = () => {
      timers.current.delete(key);
      onEnd();
    };
    const next = (left: number) =>
      timers.current.set(
        key,
        setTimeout(() => {
          read()
            .then((item) => {
              show(item);
              if (!done(item) && left > 1) next(left - 1);
              else end();
            })
            .catch(end);
        }, WATCH_MS),
      );
    clearTimeout(timers.current.get(key));
    next(times);
  }, []);
}
