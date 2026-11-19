import { describe, expect, it, vi } from "vitest";
import { inTurn } from "./inTurn.js";

describe("inTurn", () => {
  it("runs each item one after another and reports progress", async () => {
    const order: number[] = [];
    const progress = vi.fn();
    const failed = await inTurn([1, 2, 3], async (n) => void order.push(n), progress);
    expect(order).toEqual([1, 2, 3]);
    expect(progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(failed).toEqual([]);
  });

  it("keeps going after a failure and returns what failed, with why", async () => {
    const seen: number[] = [];
    const failed = await inTurn(
      [1, 2, 3],
      async (n) => {
        seen.push(n);
        if (n === 2) throw new Error("This suggestion can no longer be decided.");
      },
      () => {},
    );
    expect(seen).toEqual([1, 2, 3]);
    expect(failed).toEqual([{ item: 2, message: "This suggestion can no longer be decided." }]);
  });
});
