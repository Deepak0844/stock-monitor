import { describe, expect, it } from "vitest";
import { ApiError } from "../api.js";
import { createQueryClient, shouldRetry } from "./client.js";

describe("shouldRetry", () => {
  it("retries when the server can't be reached", () => {
    expect(shouldRetry(0, new ApiError("x", 0))).toBe(true);
  });

  it("retries a server error until two retries are used", () => {
    expect(shouldRetry(1, new ApiError("x", 503))).toBe(true);
    expect(shouldRetry(2, new ApiError("x", 503))).toBe(false);
  });

  it("never retries a request the server refused", () => {
    expect(shouldRetry(0, new ApiError("x", 404))).toBe(false);
    expect(shouldRetry(0, new ApiError("x", 401))).toBe(false);
  });
});

describe("createQueryClient", () => {
  it("keeps data fresh for 30 seconds and never retries a save", () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.retry).toBe(shouldRetry);
    expect(defaults.mutations?.retry).toBe(false);
  });
});
