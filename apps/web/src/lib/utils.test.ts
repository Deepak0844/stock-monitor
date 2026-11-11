import { describe, expect, it } from "vitest";
import { cn } from "./utils.js";

describe("cn", () => {
  it("joins class names and drops falsy ones", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
  it("lets the later Tailwind class win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
