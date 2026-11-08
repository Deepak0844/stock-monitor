import { describe, expect, it } from "vitest";
import { createThrottleTracker } from "./throttle.js";

const SECOND = 1000;

function setup() {
  let now = 5_000_000;
  const tracker = createThrottleTracker(() => now);
  return { tracker, advance: (ms: number) => (now += ms) };
}

const status = (currentlyAvailable: number, restoreRate = 50, maximumAvailable = 1000) => ({
  maximumAvailable,
  currentlyAvailable,
  restoreRate,
});

describe("throttle tracker", () => {
  it("does not make anyone wait before it has seen a response", () => {
    expect(setup().tracker.waitMs(500)).toBe(0);
  });

  it("does not wait when the bucket has enough room", () => {
    const { tracker } = setup();
    tracker.update(status(800));
    expect(tracker.waitMs(300)).toBe(0);
  });

  it("waits for the bucket to refill when the next query is bigger than what is left", () => {
    const { tracker } = setup();
    tracker.update(status(50, 50)); // 50 points left, refills 50 points a second
    expect(tracker.waitMs(150)).toBe(2 * SECOND); // 100 points short, so 2 seconds
  });

  it("counts the time that has already passed", () => {
    const { tracker, advance } = setup();
    tracker.update(status(50, 50));
    advance(1 * SECOND);
    expect(tracker.waitMs(150)).toBe(1 * SECOND);
    advance(1 * SECOND);
    expect(tracker.waitMs(150)).toBe(0);
  });

  it("never expects the bucket to hold more than its maximum", () => {
    const { tracker, advance } = setup();
    tracker.update(status(900, 50, 1000));
    advance(60 * SECOND);
    expect(tracker.waitMs(1000)).toBe(0);
  });

  it("waits only for a full bucket when a query is larger than the whole bucket", () => {
    const { tracker } = setup();
    tracker.update(status(0, 100, 1000));
    expect(tracker.waitMs(5000)).toBe(10 * SECOND); // 1000 points at 100 a second
  });

  it("falls back to one second when the refill rate is unknown or zero", () => {
    const { tracker } = setup();
    tracker.update(status(0, 0));
    expect(tracker.waitMs(100)).toBe(1 * SECOND);
  });

  it("never asks for more than a minute", () => {
    const { tracker } = setup();
    tracker.update(status(0, 1, 1000));
    expect(tracker.waitMs(1000)).toBe(60 * SECOND);
  });

  it("uses the newest information", () => {
    const { tracker } = setup();
    tracker.update(status(0, 50));
    tracker.update(status(900, 50));
    expect(tracker.waitMs(100)).toBe(0);
  });

  it("ignores a status that is not made of numbers", () => {
    const { tracker } = setup();
    tracker.update(status(0, 50));
    tracker.update({ maximumAvailable: "lots", currentlyAvailable: null, restoreRate: undefined } as never);
    expect(tracker.waitMs(100)).toBe(2 * SECOND);
  });

  it("reports what it last saw", () => {
    const { tracker } = setup();
    expect(tracker.last()).toBeNull();
    tracker.update(status(123, 50));
    expect(tracker.last()?.currentlyAvailable).toBe(123);
  });
});
