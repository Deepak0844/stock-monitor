// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { toast } from "./toast.js";
import { OfflineBar } from "../components/OfflineBar.js";
import { render } from "@testing-library/react";

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

  it("keeps an error until it is closed, and says it as an alert", () => {
    act(() => void toast("Couldn't reach Shopify. Nothing was changed.", { kind: "error" }));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach Shopify. Nothing was changed.");
  });

  it("runs its action once and closes when the action is pressed", async () => {
    const run = vi.fn();
    act(() => void toast("3 proposals rejected.", { action: { label: "Undo", run } }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("3 proposals rejected.")).toBeNull();
  });

  it("stays as long as it is told to", () => {
    act(() => void toast("Link deleted.", { durationMs: 5_000 }));
    act(() => void vi.advanceTimersByTime(4_900));
    expect(screen.getByText("Link deleted.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByText("Link deleted.")).toBeNull();
  });
});

describe("OfflineBar", () => {
  afterEach(() => vi.restoreAllMocks());

  it("appears when the browser goes offline and the server cannot be reached, and leaves when it is back", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<OfflineBar />);
    expect(screen.queryByText(/You're offline/)).toBeNull();
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });

  it("stays hidden when the browser wrongly says offline but the server answers", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"status":"ok"}'));
    render(<OfflineBar />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(fetch).toHaveBeenCalledWith("/health", expect.objectContaining({ cache: "no-store" }));
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });

  it("goes away by itself once the server answers again", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<OfflineBar />);
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
    fetch.mockResolvedValue(new Response('{"status":"ok"}'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });
});
