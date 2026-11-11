// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { toast } from "./toast.js";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("toasts", () => {
  it("shows a message in a polite live region, and removes it after a few seconds", () => {
    act(() => toast("Label saved."));
    expect(screen.getByRole("status")).toHaveTextContent("Label saved.");
    act(() => void vi.advanceTimersByTime(4_500));
    expect(screen.queryByText("Label saved.")).toBeNull();
  });

  it("stacks several, and each can be dismissed", async () => {
    act(() => {
      toast("First.");
      toast("Second.");
    });
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(screen.queryByText("First.")).toBeNull();
    expect(screen.getByText("Second.")).toBeInTheDocument();
  });

});
