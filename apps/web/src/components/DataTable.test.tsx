// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { DataTable, type Column } from "./DataTable.js";
import { RowsSwitch } from "./RowsSwitch.js";
import { resetPreferencesForTests } from "../lib/preferences.js";

afterEach(cleanup);
type Row = { id: string; name: string };
const columns = [{ header: "Name", cell: (r: Row) => r.name }];
const base = {
  columns,
  rowKey: (r: Row) => r.id,
  onRetry: vi.fn(),
  empty: <p>Nothing here yet.</p>,
  pageSize: 3,
};

describe("DataTable", () => {
  it("shows one skeleton row per page row while loading, and marks itself busy", () => {
    const { container } = render(
      <DataTable {...base} rows={null} loading error={null} label="Suppliers" />,
    );
    expect(screen.getByRole("table", { name: "Suppliers" })).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(screen.queryByText("Nothing here yet.")).not.toBeInTheDocument();
  });

  it("shows the error with a Retry button", async () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        {...base}
        onRetry={onRetry}
        rows={null}
        loading={false}
        error="Could not load suppliers."
        label="Suppliers"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load suppliers.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the empty message when there are no rows", () => {
    render(<DataTable {...base} rows={[]} loading={false} error={null} label="Suppliers" />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("lays each row out as a short card on a phone when its columns say how", () => {
    const cols = [
      { header: "Name", cell: (r: Row) => r.name },
      { header: "Town", cell: () => "Leeds", phone: "half" as const },
      { header: "Checked", cell: () => "03:15", phone: "inline-label" as const },
      { header: "Notes", cell: () => "x", phone: "hide" as const },
    ];
    render(
      <DataTable
        {...base}
        columns={cols}
        rows={[{ id: "1", name: "Ashgrove" }]}
        loading={false}
        error={null}
        label="Suppliers"
      />,
    );
    expect(screen.getByRole("table")).toHaveClass("cards");
    expect(screen.getByRole("cell", { name: "Leeds" })).toHaveClass("phone-half");
    expect(screen.getByRole("cell", { name: "03:15" })).toHaveClass("phone-inline-label");
    expect(screen.getByRole("cell", { name: "x" })).toHaveClass("phone-hide");
  });

  it("shows the rows", () => {
    render(
      <DataTable
        {...base}
        rows={[{ id: "1", name: "Ashgrove" }]}
        loading={false}
        error={null}
        label="Suppliers"
      />,
    );
    expect(screen.getByRole("cell", { name: "Ashgrove" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Suppliers" })).toHaveAttribute("aria-busy", "false");
  });
});

describe("DataTable sorting, selecting and row height", () => {
  type Item = { id: string; name: string; supplier: string; url: string };
  const items: Item[] = [
    { id: "a", name: "Oak board", supplier: "Northline", url: "northline-trade.example/oak" },
    { id: "b", name: "Apron", supplier: "Brightwell", url: "brightwell.example/apron" },
    { id: "c", name: "Mug", supplier: "Kestrel", url: "kestrel.example/" + "x".repeat(200) },
  ];
  const cols: Column<Item>[] = [
    { header: "Product", cell: (r) => r.name, sortKey: "product" },
    { header: "Supplier", cell: (r) => r.supplier, sortKey: "supplier" },
    { header: "Page", cell: (r) => r.url, truncate: true, title: (r) => r.url },
  ];
  const props = {
    columns: cols,
    rows: items,
    rowKey: (r: Item) => r.id,
    loading: false,
    error: null,
    onRetry: vi.fn(),
    empty: null,
    pageSize: 3,
    label: "Links",
  };

  afterEach(() => {
    localStorage.clear();
    resetPreferencesForTests();
  });

  it("asks to sort when a sortable heading is pressed, and says which way it is sorted", async () => {
    const onSort = vi.fn();
    render(<DataTable {...props} sort={{ key: "supplier", dir: "asc" }} onSort={onSort} />);
    expect(screen.getByRole("columnheader", { name: /Supplier/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /Product/ })).toHaveAttribute(
      "aria-sort",
      "none",
    );
    await userEvent.click(screen.getByRole("button", { name: /Product/ }));
    expect(onSort).toHaveBeenCalledWith("product");
  });

  it("ticks every row on the page from the heading box, and shows some-ticked as mixed", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DataTable
        {...props}
        selection={{ selected: new Set(), onChange, rowLabel: (r) => r.name }}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(onChange).toHaveBeenCalledWith(new Set(["a", "b", "c"]));
    rerender(
      <DataTable
        {...props}
        selection={{ selected: new Set(["b"]), onChange, rowLabel: (r) => r.name }}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Select all on this page" })).toHaveProperty(
      "indeterminate",
      true,
    );
    expect(screen.getByRole("checkbox", { name: "Select Apron" })).toBeChecked();
  });

  it("packs rows tighter when the owner picks compact", () => {
    render(
      <>
        <RowsSwitch />
        <DataTable {...props} />
      </>,
    );
    expect(screen.getByRole("table", { name: "Links" })).toHaveAttribute(
      "data-density",
      "comfortable",
    );
    act(() => screen.getByRole("button", { name: "Compact" }).click());
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table", { name: "Links" })).toHaveAttribute("data-density", "compact");
  });

  it("cuts off a very long value and puts the whole of it in a tooltip", async () => {
    render(<DataTable {...props} />);
    const cut = screen.getByText(items[2]!.url);
    expect(cut).toHaveClass("truncate");
    act(() => cut.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(items[2]!.url);
  });
});
