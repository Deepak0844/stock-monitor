import { describe, expect, it } from "vitest";
import { readNumber } from "./numbers.js";

describe("readNumber", () => {
  it.each([
    ["46", 46],
    ["1,204", 1204],
    ["12+", 12],
    ["Only 3 left", 3],
    ["0", 0],
    ["  7  ", 7],
  ])("reads %j as %j", (text, n) => expect(readNumber(text)).toBe(n));
  it.each([["Out of stock"], [""], ["n/a"]])("finds no number in %j", (text) => expect(readNumber(text)).toBeNull());
});
