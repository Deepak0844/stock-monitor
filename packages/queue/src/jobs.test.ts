import { describe, expect, it } from "vitest";
import { parseJob } from "./jobs.js";

describe("parseJob", () => {
  it("returns a valid payload", () => {
    expect(parseJob("health.ping", { message: "hello" })).toEqual({ message: "hello" });
  });

  it("rejects a payload with the wrong shape", () => {
    expect(() => parseJob("health.ping", { message: 5 })).toThrow(/health\.ping/);
  });

  it("rejects an empty message", () => {
    expect(() => parseJob("health.ping", { message: "" })).toThrow();
  });

  it("rejects an unknown job name", () => {
    expect(() => parseJob("nope" as never, {})).toThrow(/unknown job/i);
  });
});
