// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { DataTable } from "./DataTable.js";

afterEach(cleanup);
type Row = { id: string; name: string };
const columns = [{ header: "Name", cell: (r: Row) => r.name }];
const base = { columns, rowKey: (r: Row) => r.id, onRetry: vi.fn(), empty: <p>Nothing here yet.</p>, pageSize: 3 };

describe("DataTable", () => {
  it("shows one skeleton row per page row while loading, and marks itself busy", () => {
    const { container } = render(<DataTable {...base} rows={null} loading error={null} label="Suppliers" />);
    expect(screen.getByRole("region", { name: "Suppliers" })).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(screen.queryByText("Nothing here yet.")).not.toBeInTheDocument();
  });

  it("shows the error with a Retry button", async () => {
    const onRetry = vi.fn();
    render(<DataTable {...base} onRetry={onRetry} rows={null} loading={false} error="Could not load suppliers." label="Suppliers" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load suppliers.");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the empty message when there are no rows", () => {
    render(<DataTable {...base} rows={[]} loading={false} error={null} label="Suppliers" />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("shows the rows", () => {
    render(<DataTable {...base} rows={[{ id: "1", name: "Ashgrove" }]} loading={false} error={null} label="Suppliers" />);
    expect(screen.getByRole("cell", { name: "Ashgrove" })).toBeInTheDocument();
  });
});
