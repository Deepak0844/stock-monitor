// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { FilterSheet } from "./FilterSheet.js";

afterEach(cleanup);

describe("FilterSheet", () => {
  it("says how many filters are on, and opens a full-screen sheet holding them", async () => {
    render(
      <FilterSheet count={2} onClear={vi.fn()}>
        <label>
          Status <select aria-label="Link status" />
        </label>
      </FilterSheet>,
    );
    const user = userEvent.setup();
    expect(screen.queryByLabelText("Link status")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filters · 2" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(within(sheet).getByLabelText("Link status")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says just Filters when none is on, and Clear all clears them", async () => {
    const onClear = vi.fn();
    render(
      <FilterSheet count={0} onClear={onClear}>
        x
      </FilterSheet>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
