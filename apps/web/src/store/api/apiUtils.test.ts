import { describe, expect, it } from "vitest";
import { allKey, entityKey, listKey, pageKey } from "./apiUtils.js";

describe("cache key helpers", () => {
  it("builds every key of a type under the type's own prefix", () => {
    expect(allKey("Proposal")).toEqual(["Proposal"]);
    expect(listKey("Proposal")).toEqual(["Proposal", "list"]);
    expect(pageKey("Proposal", { page: 2, tab: "open" })).toEqual(["Proposal", "list", { page: 2, tab: "open" }]);
    expect(entityKey("Proposal", "p1")).toEqual(["Proposal", "detail", "p1"]);
  });
});
