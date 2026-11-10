export type LoginLimiter = {
  isBlocked(key: string): boolean;
  recordFailure(key: string): void;
  reset(key: string): void;
};

// In memory: fine for one API process. A restart clears it, which is acceptable for a single owner.
export function createLoginLimiter(opts: {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
}): LoginLimiter {
  const now = opts.now ?? Date.now;
  const failures = new Map<string, number[]>();

  const recent = (key: string) => {
    const cutoff = now() - opts.windowMs;
    const kept = (failures.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };

  return {
    isBlocked: (key) => recent(key).length >= opts.maxFailures,
    recordFailure(key) {
      failures.set(key, [...recent(key), now()]);
    },
    reset: (key) => void failures.delete(key),
  };
}
