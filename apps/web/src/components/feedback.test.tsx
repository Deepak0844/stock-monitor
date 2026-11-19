// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider, Tip } from "./ui/tooltip.js";
import { When } from "./When.js";
import { CopyButton } from "./CopyButton.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const withTips = (ui: React.ReactElement) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

describe("Tip", () => {
  it("shows its words when the thing it explains gets keyboard focus", async () => {
    withTips(
      <Tip label="More actions">
        <button aria-label="More actions">⋯</button>
      </Tip>,
    );
    act(() => screen.getByRole("button", { name: "More actions" }).focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("More actions");
  });
});

describe("When", () => {
  it("shows a short time and puts the full date and time in its tooltip", async () => {
    withTips(<When at="2026-11-19T09:14:22" />);
    const time = screen.getByText(/19 Nov 2026/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-11-19T09:14:22");
    act(() => time.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/Thursday,? 19 November 2026 at 09:14:22/);
  });
});

describe("CopyButton", () => {
  it("copies the value, says Copied, and stops saying it after two seconds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.useFakeTimers();
    withTips(<CopyButton value="OSB-L" label="SKU" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy SKU" })));
    expect(writeText).toHaveBeenCalledWith("OSB-L");
    expect(screen.getByText("Copied")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("says so when the browser refuses to copy", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    withTips(<CopyButton value="OSB-L" label="SKU" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy SKU" })));
    expect(screen.getByText("Couldn't copy")).toBeInTheDocument();
  });
});
