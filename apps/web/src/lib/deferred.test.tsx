// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { deferred, UNDO_MS } from "./deferred.js";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const start = (commit = vi.fn().mockResolvedValue(undefined)) => {
  const onUndo = vi.fn();
  const onFailed = vi.fn();
  act(() => deferred({ text: "Link deleted.", commit, onUndo, onFailed }));
  return { commit, onUndo, onFailed };
};

describe("deferred actions with Undo", () => {
  it("waits five seconds before sending, then sends once", async () => {
    const { commit } = start();
    expect(UNDO_MS).toBe(5000);
    await act(async () => void vi.advanceTimersByTime(4999));
    expect(commit).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(1));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(false);
  });

  it("never sends when Undo is pressed in time, and puts things back", async () => {
    const { commit, onUndo } = start();
    await act(async () => void vi.advanceTimersByTime(3000));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(commit).not.toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("sends at once, kept alive, when the owner leaves the page", async () => {
    const { commit } = start();
    await act(async () => void vi.advanceTimersByTime(1000));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(true);
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("puts things back and says so when the delayed request fails", async () => {
    const { onFailed } = start(vi.fn().mockRejectedValue(new Error("That suggestion was already decided.")));
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(onFailed).toHaveBeenCalledWith("That suggestion was already decided.");
    expect(screen.getByRole("alert")).toHaveTextContent("That suggestion was already decided.");
  });
});
