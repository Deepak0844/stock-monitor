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

  it("accepts an empty shopify.sync payload", () => {
    expect(parseJob("shopify.sync", {})).toEqual({});
  });

  it("refuses any data in a shopify.sync payload, so a secret can never ride along in a job", () => {
    expect(() => parseJob("shopify.sync", { clientSecret: "x" })).toThrow(/shopify\.sync/);
    expect(() => parseJob("shopify.sync", { anything: 1 })).toThrow();
  });
});
