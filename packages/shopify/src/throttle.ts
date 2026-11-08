export type ThrottleStatus = { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };

const MAX_WAIT_MS = 60_000;
const FALLBACK_WAIT_MS = 1000; // Shopify's recommended backoff when nothing better is known

const isStatus = (value: unknown): value is ThrottleStatus => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return ["maximumAvailable", "currentlyAvailable", "restoreRate"].every(
    (key) => typeof v[key] === "number" && Number.isFinite(v[key]),
  );
};

/**
 * Remembers the cost bucket Shopify last reported and works out how long to wait before a query of
 * a given cost fits. Shopify documents the bucket and its refill rate but gives no formula for the
 * wait, so this is our own: points missing, divided by the refill rate per second.
 */
export function createThrottleTracker(now: () => number) {
  let last: { status: ThrottleStatus; at: number } | null = null;

  return {
    update(status: unknown): void {
      if (isStatus(status)) last = { status, at: now() };
    },

    /** Milliseconds to wait before sending a query expected to cost `estimatedCost` points. */
    waitMs(estimatedCost: number): number {
      if (!last) return 0;
      const { maximumAvailable, currentlyAvailable, restoreRate } = last.status;
      const elapsedSeconds = (now() - last.at) / 1000;
      const available = Math.min(maximumAvailable, currentlyAvailable + Math.max(0, restoreRate) * elapsedSeconds);
      const needed = Math.min(estimatedCost, maximumAvailable); // a query can never need more than a full bucket
      if (available >= needed) return 0;
      if (restoreRate <= 0) return FALLBACK_WAIT_MS;
      return Math.min(MAX_WAIT_MS, Math.ceil(((needed - available) * 1000) / restoreRate));
    },

    /** What Shopify last reported, not extrapolated. */
    last(): ThrottleStatus | null {
      return last?.status ?? null;
    },
  };
}
