// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useListParams } from "./useListParams.js";

const at = (search: string) => window.history.replaceState(null, "", `/suppliers${search}`);
beforeEach(() => at(""));
afterEach(cleanup);

describe("useListParams", () => {
  it("falls back to page 1 and the default size when the address has nonsense", () => {
    at("?page=abc&pageSize=7");
    const { result } = renderHook(() => useListParams({ pageSize: 10 }));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
  });

  it("reads page, size, search and filters from the address", () => {
    at("?page=3&pageSize=25&search=ash&status=paused");
    const { result } = renderHook(() => useListParams({ pageSize: 10 }));
    expect(result.current).toMatchObject({ page: 3, pageSize: 25, search: "ash", filters: { status: "paused" } });
  });

  it("goes back to page 1 when the search changes, and writes it to the address", () => {
    at("?page=4");
    const { result } = renderHook(() => useListParams({ pageSize: 10 }));
    act(() => result.current.set({ search: "x" }));
    expect(window.location.search).toBe("?search=x");
    expect(result.current.page).toBe(1);
  });

  it("keeps the page when only the page is set, and drops a filter set to empty", () => {
    at("?status=paused");
    const { result } = renderHook(() => useListParams({ pageSize: 10 }));
    act(() => result.current.set({ page: 2 }));
    expect(window.location.search).toBe("?status=paused&page=2");
    act(() => result.current.set({ status: undefined }));
    expect(window.location.search).toBe("");
  });
});
