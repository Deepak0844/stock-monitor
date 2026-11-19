// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { SearchSelect, type SearchOption } from "./SearchSelect.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SUPPLIERS: SearchOption[] = [
  { id: "b", label: "Brightwell Trade", detail: "brightwell.example", count: 655 },
  { id: "h", label: "Harbour Goods", detail: "harbourgoods.example", count: 162, disabled: true, note: "logged out" },
  { id: "n", label: "Northline Wholesale", detail: "northline-trade.example", count: 812 },
];

const setup = (props: Partial<React.ComponentProps<typeof SearchSelect>> = {}) => {
  const onChange = vi.fn();
  render(
    <SearchSelect
      label="Supplier"
      value={null}
      options={SUPPLIERS}
      allOption={{ id: "", label: "All suppliers", count: 2169 }}
      placeholder="Search suppliers"
      noMatch={(q) => `No supplier matches "${q}".`}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, user: userEvent.setup() };
};

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /Supplier/ }));
  return screen.getByRole("combobox", { name: "Search suppliers" });
};

describe("SearchSelect", () => {
  it("narrows the list as you type, matching the name or the website, and marks the matching letters", async () => {
    const { user } = setup();
    await user.type(await open(user), "tr");
    const list = screen.getByRole("listbox");
    const names = within(list).getAllByRole("option").map((o) => o.textContent);
    expect(names.some((n) => n?.includes("Brightwell Trade"))).toBe(true);
    expect(names.some((n) => n?.includes("Northline Wholesale"))).toBe(true);
    expect(names.some((n) => n?.includes("Harbour Goods"))).toBe(false);
    expect(within(list).getAllByText("Tr", { selector: "mark" }).length).toBeGreaterThan(0);
  });

  it("always offers All suppliers first, which clears the choice", async () => {
    const { user, onChange } = setup({ value: "n", valueLabel: "Northline Wholesale" });
    await open(user);
    const first = within(screen.getByRole("listbox")).getAllByRole("option")[0]!;
    expect(first).toHaveTextContent("All suppliers");
    await user.click(first);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("moves with the arrow keys, skips one that cannot be picked, and Enter picks", async () => {
    const { user, onChange } = setup();
    const box = await open(user);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    const active = box.getAttribute("aria-activedescendant");
    expect(document.getElementById(active!)).toHaveTextContent("Brightwell Trade");
    await user.keyboard("{ArrowDown}");
    expect(document.getElementById(box.getAttribute("aria-activedescendant")!)).toHaveTextContent("Northline Wholesale");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("n");
  });

  it("does nothing when a disabled option is clicked", async () => {
    const { user, onChange } = setup();
    await open(user);
    const harbour = screen.getByRole("option", { name: /Harbour Goods/ });
    expect(harbour).toHaveAttribute("aria-disabled", "true");
    await user.click(harbour);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on Escape and puts focus back on the field", async () => {
    const { user } = setup();
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Supplier/ })).toHaveFocus();
  });

  it("says so when nothing matches", async () => {
    const { user } = setup();
    await user.type(await open(user), "zzz");
    expect(screen.getByText('No supplier matches "zzz".')).toBeInTheDocument();
  });

  it("searches on the server and shows only the latest answer when answers arrive out of order", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers: Record<string, { after: number; options: SearchOption[] }> = {
      "": { after: 0, options: [] },
      o: { after: 900, options: [{ id: "x", label: "Old ring" }] },
      oak: { after: 10, options: [{ id: "v1", label: "Oak serving board", detail: "Large · OSB-L" }] },
    };
    const search = vi.fn((q: string) => new Promise<SearchOption[]>((resolve) => setTimeout(() => resolve(answers[q]!.options), answers[q]!.after)));
    const { user } = setup({ options: undefined, allOption: undefined, search, placeholder: "Search suppliers" });
    const box = await open(user);
    await user.type(box, "o");
    await act(async () => void vi.advanceTimersByTime(350)); // "o" is asked, and answers slowly
    await user.type(box, "ak");
    await act(async () => void vi.advanceTimersByTime(350)); // "oak" is asked, and answers quickly
    await act(async () => void vi.advanceTimersByTime(1000)); // the late "o" answer arrives
    expect(screen.getByRole("option", { name: /Oak serving board/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Old ring/ })).not.toBeInTheDocument();
  });
  it("puts the whole of a long name in a tooltip title, on each option and on the field", async () => {
    const long = "Northline " + "x".repeat(200);
    const { user } = setup({ options: [{ id: "n", label: long, detail: "northline-trade.example" }], value: "n" });
    expect(screen.getByRole("button", { name: /Supplier/ })).toHaveAttribute("title", long);
    await open(user);
    expect(screen.getByRole("option", { name: /Northline/ })).toHaveAttribute("title", `${long} · northline-trade.example`);
  });
});
