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

  describe("supplier.session.verify", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    it("carries only the supplier's id", () => {
      expect(parseJob("supplier.session.verify", { supplierId: id })).toEqual({ supplierId: id });
    });
    it("needs a supplier id, and it must be an id", () => {
      expect(() => parseJob("supplier.session.verify", {})).toThrow(/supplier\.session\.verify/);
      expect(() => parseJob("supplier.session.verify", { supplierId: "acme" })).toThrow();
    });
    it("refuses anything else, so a session, cookie or token can never ride along in a job", () => {
      expect(() => parseJob("supplier.session.verify", { supplierId: id, state: { cookies: [] } })).toThrow();
      expect(() => parseJob("supplier.session.verify", { supplierId: id, cookie: "x" })).toThrow();
    });
  });

  describe("scheduling.tick", () => {
    it("carries no data", () => {
      expect(parseJob("scheduling.tick", {})).toEqual({});
      expect(() => parseJob("scheduling.tick", { x: 1 })).toThrow();
    });
  });

  describe("proposals.evaluate", () => {
    const supplierId = "3f0c1f4e-7b1a-4c53-9a53-0c8f6f5d9a11";
    it("takes nothing, a supplier or a link, and no other field", () => {
      expect(parseJob("proposals.evaluate", {})).toEqual({});
      expect(parseJob("proposals.evaluate", { supplierId })).toEqual({ supplierId });
      expect(parseJob("proposals.evaluate", { mappingId: supplierId })).toEqual({ mappingId: supplierId });
      expect(() => parseJob("proposals.evaluate", { supplierId: "nope" })).toThrow();
      expect(() => parseJob("proposals.evaluate", { cookie: "x" })).toThrow();
    });
  });

  describe("proposals.apply", () => {
    it("takes one suggestion id and nothing else", () => {
      const proposalId = "3f0c1f4e-7b1a-4c53-9a53-0c8f6f5d9a11";
      expect(parseJob("proposals.apply", { proposalId })).toEqual({ proposalId });
      expect(() => parseJob("proposals.apply", {})).toThrow();
      expect(() => parseJob("proposals.apply", { proposalId, quantity: 3 })).toThrow();
    });
  });

  describe("extraction.checks", () => {
    const supplierId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    it("carries the supplier's id and the run's id, and nothing else", () => {
      expect(parseJob("extraction.checks", { supplierId, runId })).toEqual({ supplierId, runId });
      expect(() => parseJob("extraction.checks", { supplierId })).toThrow(/extraction\.checks/);
      expect(() => parseJob("extraction.checks", { supplierId, runId, cookie: "x" })).toThrow();
    });
  });
});
