import { describe, expect, it } from "vitest";
import { createLoginLimiter } from "./rate-limit.js";

const MIN = 60_000;

function setup() {
  let now = 1_000_000;
  const limiter = createLoginLimiter({ maxFailures: 5, windowMs: 15 * MIN, now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe("login limiter", () => {
  it("does not block a key with no failures", () => {
    expect(setup().limiter.isBlocked("a")).toBe(false);
  });

  it("blocks after the maximum number of failures", () => {
    const { limiter } = setup();
    for (let i = 0; i < 4; i++) limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(false);
    limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(true);
  });

  it("unblocks once the failures are older than the window", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 5; i++) limiter.recordFailure("a");
    advance(15 * MIN + 1);
    expect(limiter.isBlocked("a")).toBe(false);
  });

  it("clears the count when the key signs in successfully", () => {
    const { limiter } = setup();
    for (let i = 0; i < 4; i++) limiter.recordFailure("a");
    limiter.reset("a");
    limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(false);
  });

  it("tracks keys independently", () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) limiter.recordFailure("a");
    expect(limiter.isBlocked("b")).toBe(false);
  });
});
