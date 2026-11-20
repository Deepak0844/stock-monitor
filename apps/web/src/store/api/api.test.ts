import { afterEach, describe, expect, it } from "vitest";
import { MutationObserver } from "@tanstack/react-query";
import { ApiError } from "../../api.js";
import { clearToasts, getToasts } from "../../lib/toast.js";
import { createQueryClient, shouldRetry } from "./api.js";

afterEach(clearToasts);

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

  it("sends a failed read to the error handler with the query's meta", async () => {
    const client = createQueryClient();
    const fail = () => Promise.reject(new ApiError("Settings could not be read.", 400));
    await client.fetchQuery({ queryKey: ["quiet"], queryFn: fail, retry: false }).catch(() => {});
    expect(getToasts()).toEqual([]);
    await client.fetchQuery({ queryKey: ["loud"], queryFn: fail, retry: false, meta: { showToaster: true } }).catch(() => {});
    expect(getToasts().map((t) => [t.text, t.kind])).toEqual([["Settings could not be read.", "error"]]);
  });

  it("sends a failed save to the error handler with the mutation's meta", async () => {
    const client = createQueryClient();
    const save = new MutationObserver(client, { mutationFn: () => Promise.reject(new ApiError("Not saved.", 400)), meta: { showToaster: true } });
    await save.mutate().catch(() => {});
    expect(getToasts().map((t) => t.text)).toEqual(["Not saved."]);
  });
});
