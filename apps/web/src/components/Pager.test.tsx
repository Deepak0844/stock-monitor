// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Pager } from "./Pager.js";

afterEach(cleanup);

describe("Pager", () => {
  it("says which rows are showing and marks the current page", () => {
    render(<Pager page={2} pageSize={10} total={42} onPage={vi.fn()} onPageSize={vi.fn()} />);
    expect(screen.getByText("Showing 11–20 of 42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(<Pager page={1} pageSize={10} total={25} onPage={vi.fn()} onPageSize={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    rerender(<Pager page={3} pageSize={10} total={25} onPage={vi.fn()} onPageSize={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByText("Showing 21–25 of 25")).toBeInTheDocument();
  });

  it("asks for a page and a size", async () => {
    const onPage = vi.fn();
    const onPageSize = vi.fn();
    render(<Pager page={1} pageSize={10} total={42} onPage={onPage} onPageSize={onPageSize} />);
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(2);
    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "25");
    expect(onPageSize).toHaveBeenCalledWith(25);
  });

  it("moves to the last page once when the page is past the end", () => {
    const onPage = vi.fn();
    render(<Pager page={9} pageSize={10} total={42} onPage={onPage} onPageSize={vi.fn()} />);
    expect(onPage).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("shows nothing to page through when there are no rows", () => {
    render(<Pager page={1} pageSize={10} total={0} onPage={vi.fn()} onPageSize={vi.fn()} />);
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
