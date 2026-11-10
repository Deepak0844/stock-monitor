export const INTERVALS = [60, 180, 360, 720, 1440] as const;
export const DEFAULT_INTERVAL = 1440;
export type Window = { start: string; end: string } | null; // "HH:MM" local time, null = all day
export const DEFAULT_WINDOW = { start: "07:00", end: "22:00" } as const;

const MINUTE = 60_000;
const SPREAD = 0.1;
const BACKOFF_MINUTES = [15, 60, 240];

/** Minutes since local midnight in the given zone. */
function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

const toMinutes = (hhmm: string): number => {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

export function insideWindow(at: Date, window: Window, timeZone: string): boolean {
  if (!window) return true;
  const now = localMinutes(at, timeZone);
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

/** The earliest time at or after `from` that is inside the window. Steps by 15 minutes, so daylight saving needs no special case. */
export function intoWindow(from: Date, window: Window, timeZone: string): Date {
  if (insideWindow(from, window, timeZone)) return from;
  const step = 15 * MINUTE;
  // Round up to the next quarter hour so the result lands on a window edge (07:00, not 07:07).
  let t = Math.ceil(from.getTime() / step) * step;
  for (let i = 0; i < 48 * 4 && !insideWindow(new Date(t), window, timeZone); i++) t += step;
  return new Date(t);
}

export function nextCheckAt(now: Date, intervalMinutes: number, window: Window, timeZone: string, rand: () => number = Math.random): Date {
  const spread = Math.round(rand() * SPREAD * intervalMinutes);
  return intoWindow(new Date(now.getTime() + (intervalMinutes + spread) * MINUTE), window, timeZone);
}

/** Milliseconds to wait after the given number of failed runs in a row. Never shorter than the supplier's own pause. */
export function backoffMs(failureCount: number, pauseSeconds: number): number {
  const step = BACKOFF_MINUTES[Math.min(Math.max(failureCount, 1), BACKOFF_MINUTES.length) - 1] as number;
  return Math.max(step * MINUTE, pauseSeconds * 1000);
}

export function isStale(lastCheckedAt: Date | null, intervalMinutes: number | null, now: Date): boolean {
  if (!lastCheckedAt || !intervalMinutes) return false;
  return now.getTime() - lastCheckedAt.getTime() > 2 * intervalMinutes * MINUTE;
}

export type DueCandidate = { id: string; nextCheckAt: Date; window: Window };

/** Suppliers to start now: due, inside their window, oldest first, no more than the room left under the limit. */
export function pickDue(candidates: DueCandidate[], now: Date, running: number, max: number, timeZone: string): string[] {
  return candidates
    .filter((c) => c.nextCheckAt <= now && insideWindow(now, c.window, timeZone))
    .sort((a, b) => a.nextCheckAt.getTime() - b.nextCheckAt.getTime())
    .slice(0, Math.max(0, max - running))
    .map((c) => c.id);
}

const PER_PAGE_EXTRA_SECONDS = 30;
/** How long the queue may let a whole-supplier run go before giving up on it. It waits the supplier's pause between pages, so it is long. */
export function runExpirySeconds(links: number, pauseSeconds: number): number {
  return Math.min(6 * 3600, Math.max(15 * 60, links * (pauseSeconds + PER_PAGE_EXTRA_SECONDS)));
}
