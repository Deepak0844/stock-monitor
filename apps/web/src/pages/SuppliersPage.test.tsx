// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError, type ScheduleRow, type Supplier } from "../api.js";
import { aRun, aSupplier, fakeApi } from "../test/fake-api.js";
import { SuppliersPage } from "./SuppliersPage.js";

beforeEach(() => window.history.replaceState(null, "", "/suppliers"));
afterEach(cleanup);

const acme = aSupplier();
const globex = aSupplier({ id: "22222222-2222-4222-8222-222222222222", name: "Globex", websiteUrl: "https://globex.example/login" });

const statusOfRow = (s: Supplier) => (!s.enabled && s.pausedReason !== "session" ? "paused" : s.sessionStatus);
/** A tiny fake server: filters, then slices, like the real one. */
const serve = (getAll: () => Supplier[]) =>
  vi.fn().mockImplementation(async (q: { page: number; pageSize: number; search?: string; status?: string }) => {
    const found = getAll().filter((s) => (!q.search || s.name.toLowerCase().includes(q.search.toLowerCase())) && (!q.status || statusOfRow(s) === q.status));
    return { items: found.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: found.length, page: q.page, pageSize: q.pageSize };
  });

const setup = (suppliers: Supplier[], over: Parameters<typeof fakeApi>[0] = {}) => {
  let current = suppliers;
  const api = fakeApi({
    ...over,
    suppliers: { list: vi.fn().mockImplementation(async () => current), page: serve(() => current), remove: vi.fn().mockImplementation(async (id: string) => void (current = current.filter((s) => s.id !== id))), ...over.suppliers },
  });
  const view = render(<SuppliersPage api={api} />);
  return { api, user: userEvent.setup(), unmount: view.unmount };
};

const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(name) });
/** Opens the "more actions" menu of one row, and returns it. */
const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole("button", { name: `More actions for ${name}` }));
  return screen.getByRole("menu");
};

describe("empty and loading", () => {
  it("shows shimmering rows and tells a screen reader it is loading", () => {
    const api = fakeApi({ suppliers: { page: vi.fn().mockReturnValue(new Promise(() => {})) } });
    render(<SuppliersPage api={api} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading suppliers…");
    expect(screen.getByRole("table", { name: "Suppliers" })).toHaveAttribute("aria-busy", "true");
  });

  it("says plainly there are no suppliers and offers to add one", async () => {
    setup([]);
    expect(await screen.findByText("No suppliers yet. Add your first supplier.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add supplier" })).toHaveAttribute("href", "/suppliers/new");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a plain error and tries again when the list cannot load", async () => {
    const page = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0));
    const { user } = setup([acme], { suppliers: { page } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    page.mockResolvedValue({ items: [acme], total: 1, page: 1, pageSize: 10 });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Acme Supply")).toBeInTheDocument();
  });

  it("says nothing matches, and how to get the list back, when a search finds nothing", async () => {
    window.history.replaceState(null, "", "/suppliers?search=zzz");
    const { user } = setup([acme]);
    expect(await screen.findByText(/No suppliers match/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(await screen.findByText("Acme Supply")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

describe("the table", () => {
  it("lists each supplier with its name, website and last-checked time, and one Add supplier link", async () => {
    setup([acme, globex]);
    const table = await screen.findByRole("table", { name: "Suppliers" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Website", "Status", "Last checked", "Automatic checks", "Actions"]);
    expect(within(rowOf("Acme Supply")).getByText("shop.acme.example")).toBeInTheDocument();
    expect(within(rowOf("Globex")).getByText("globex.example")).toBeInTheDocument();
    expect(within(rowOf("Acme Supply")).getByText("Never")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add supplier" })).toHaveLength(1);
  });

  it("shows when a supplier was last checked", async () => {
    setup([aSupplier({ lastSessionCheckAt: "2026-11-08T10:30:00.000Z" })]);
    const row = await screen.findByRole("row", { name: /Acme Supply/ });
    expect(within(row).queryByText("Never")).toBeNull();
    expect(within(row).getByText(/2026|Nov/)).toBeInTheDocument();
  });

  it.each([
    ["not_connected", "Not connected"],
    ["connected", "Connected"],
    ["needs_reconnect", "Needs reconnecting"],
    ["blocked", "Blocked"],
  ] as const)("writes the %s status in words: %s", async (sessionStatus, words) => {
    setup([aSupplier({ sessionStatus })]);
    expect(within(await screen.findByRole("row", { name: /Acme Supply/ })).getByText(words)).toBeInTheDocument();
  });

  it("shows Paused, in words, for a paused supplier whatever its session status", async () => {
    setup([aSupplier({ enabled: false, pausedReason: "owner", sessionStatus: "connected" })]);
    const row = await screen.findByRole("row", { name: /Acme Supply/ });
    expect(within(row).getByText("Paused")).toBeInTheDocument();
    expect(within(row).queryByText("Connected")).toBeNull();
  });

  it.each([
    ["needs_reconnect", "Needs reconnecting"],
    ["blocked", "Blocked"],
  ] as const)("shows %s, not Paused, when the app paused the supplier because its login needs attention", async (sessionStatus, words) => {
    setup([aSupplier({ enabled: false, pausedReason: "session", sessionStatus })]);
    const row = await screen.findByRole("row", { name: /Acme Supply/ });
    expect(within(row).getByText(words)).toBeInTheDocument();
    expect(within(row).queryByText("Paused")).toBeNull();
  });

  it("keeps the other actions in a menu named after the supplier, so a screen reader can tell them apart", async () => {
    const { user } = setup([acme, globex]);
    const menu = await openMenu(user, "Globex");
    expect(within(menu).getByRole("menuitem", { name: "Stock rules" })).toHaveAttribute("href", `/suppliers/${globex.id}/rules`);
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toHaveAttribute("href", `/suppliers/${globex.id}/edit`);
    expect(within(menu).getByRole("menuitem", { name: "Pause" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("the summary tiles", () => {
  it("count suppliers by what the owner sees, and link to the matching list", async () => {
    setup([acme, aSupplier({ id: "3", name: "Bramley", sessionStatus: "connected" }), aSupplier({ id: "4", name: "Cole", sessionStatus: "needs_reconnect" }), aSupplier({ id: "5", name: "Dunn", enabled: false, pausedReason: "owner" })]);
    const tile = (label: string) => screen.findByRole("link", { name: new RegExp(`^${label}\\s*\\d+`) });
    expect(await tile("Needs reconnecting")).toHaveTextContent("1");
    expect(await tile("Needs reconnecting")).toHaveAttribute("href", "/suppliers?status=needs_reconnect");
    expect(await tile("Connected")).toHaveTextContent("1");
    expect(await tile("Connected")).toHaveAttribute("href", "/suppliers?status=connected");
    expect(await tile("Paused")).toHaveTextContent("1");
    expect(await tile("All suppliers")).toHaveTextContent("4");
    expect(await tile("All suppliers")).toHaveAttribute("href", "/suppliers");
  });
});

describe("paging, search and filters", () => {
  const many = Array.from({ length: 23 }, (_, i) => aSupplier({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, name: `Supplier ${String(i + 1).padStart(2, "0")}`, sessionStatus: "connected" }));

  it("asks the server for the first ten, and shows where the owner is in the list", async () => {
    const { api } = setup(many);
    expect(await screen.findByText("Showing 1–10 of 23")).toBeInTheDocument();
    expect(api.suppliers.page).toHaveBeenCalledWith({ page: 1, pageSize: 10, search: undefined, status: undefined });
    expect(screen.getAllByRole("row")).toHaveLength(11);
  });

  it("goes to the next page, and keeps the page in the address", async () => {
    const { api, user } = setup(many);
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Showing 11–20 of 23")).toBeInTheDocument();
    expect(api.suppliers.page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(window.location.search).toBe("?page=2");
    expect(screen.getByText("Supplier 11")).toBeInTheDocument();
  });

  it("opens on the page and filter in the address", async () => {
    window.history.replaceState(null, "", "/suppliers?page=3&status=connected");
    const { api } = setup(many);
    expect(await screen.findByText("Showing 21–23 of 23")).toBeInTheDocument();
    expect(api.suppliers.page).toHaveBeenCalledWith({ page: 3, pageSize: 10, search: undefined, status: "connected" });
  });

  it("searches on the server after a short pause, and goes back to the first page", async () => {
    window.history.replaceState(null, "", "/suppliers?page=2");
    const { api, user } = setup(many);
    await screen.findByText("Showing 11–20 of 23");
    await user.type(screen.getByRole("searchbox", { name: "Search suppliers" }), "supplier 07");
    await waitFor(() => expect(api.suppliers.page).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, search: "supplier 07", status: undefined }));
    expect(await screen.findByText("Showing 1–1 of 1")).toBeInTheDocument();
    expect(window.location.search).toBe("?search=supplier+07");
  });

  it("filters by status from the list", async () => {
    const { api, user } = setup([acme, aSupplier({ id: "9", name: "Bramley", enabled: false, pausedReason: "owner" })]);
    await screen.findByText("Acme Supply");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by status" }), "paused");
    await waitFor(() => expect(api.suppliers.page).toHaveBeenLastCalledWith(expect.objectContaining({ status: "paused" })));
    expect(await screen.findByText("Bramley")).toBeInTheDocument();
    expect(screen.queryByText("Acme Supply")).toBeNull();
  });
});

describe("pause and resume", () => {
  it("pauses one supplier and leaves the others alone", async () => {
    const { api, user } = setup([acme, globex]);
    const menu = await openMenu(user, "Acme Supply");
    await user.click(within(menu).getByRole("menuitem", { name: "Pause" }));
    expect(api.suppliers.pause).toHaveBeenCalledWith(acme.id);
    expect(await within(rowOf("Acme Supply")).findByText("Paused")).toBeInTheDocument();
    expect(within(await openMenu(user, "Acme Supply")).getByRole("menuitem", { name: "Resume" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(within(rowOf("Globex")).queryByText("Paused")).toBeNull();
  });

  it("resumes a paused supplier", async () => {
    const paused = aSupplier({ enabled: false, pausedReason: "owner" });
    const { api, user } = setup([paused]);
    await user.click(within(await openMenu(user, "Acme Supply")).getByRole("menuitem", { name: "Resume" }));
    expect(api.suppliers.resume).toHaveBeenCalledWith(paused.id);
    expect(await within(rowOf("Acme Supply")).findByText("Not connected")).toBeInTheDocument();
  });

  it("shows the server's plain message when pausing fails, and keeps the row as it was", async () => {
    const pause = vi.fn().mockRejectedValue(new ApiError("That supplier does not exist.", 404, "supplier_not_found"));
    const { user } = setup([acme], { suppliers: { pause } });
    await user.click(within(await openMenu(user, "Acme Supply")).getByRole("menuitem", { name: "Pause" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That supplier does not exist.");
    expect(within(rowOf("Acme Supply")).getByText("Not connected")).toBeInTheDocument();
  });
});

describe("delete", () => {
  const askToDelete = async (user: ReturnType<typeof userEvent.setup>, name = "Acme Supply") => {
    await user.click(within(await openMenu(user, name)).getByRole("menuitem", { name: "Delete" }));
    return screen.getByRole("dialog", { name: `Delete ${name}?` });
  };

  it("asks first in a dialog that names the supplier, and does nothing until confirmed", async () => {
    const { api, user } = setup([acme, globex]);
    const dialog = await askToDelete(user);
    expect(dialog).toHaveTextContent("cannot undo this");
    expect(api.suppliers.remove).not.toHaveBeenCalled();
  });

  it("cancelling changes nothing", async () => {
    const { api, user } = setup([acme]);
    await askToDelete(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.suppliers.remove).not.toHaveBeenCalled();
    expect(screen.getByText("Acme Supply")).toBeInTheDocument();
  });

  it("deletes after confirming, removes the row and says so", async () => {
    const { api, user } = setup([acme, globex]);
    await askToDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete supplier" }));
    expect(api.suppliers.remove).toHaveBeenCalledWith(acme.id);
    await waitFor(() => expect(screen.queryByText("Acme Supply", { selector: "td span" })).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Deleted Acme Supply.");
    expect(screen.getByText("Globex")).toBeInTheDocument();
  });

  it("shows the empty state after the last supplier is deleted", async () => {
    const { user } = setup([acme]);
    await askToDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete supplier" }));
    expect(await screen.findByText("No suppliers yet. Add your first supplier.")).toBeInTheDocument();
  });

  it("keeps the supplier and shows the reason inside the dialog when deleting fails", async () => {
    const remove = vi.fn().mockRejectedValue(new ApiError("Something went wrong. Please try again.", 500));
    const { user } = setup([acme], { suppliers: { remove } });
    await askToDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete supplier" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("Acme Supply", { selector: "td span" })).toBeInTheDocument();
  });

  it("steps back a page when the last supplier on the last page is deleted", async () => {
    window.history.replaceState(null, "", "/suppliers?page=2");
    const eleven = Array.from({ length: 11 }, (_, i) => aSupplier({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, name: `Supplier ${String(i + 1).padStart(2, "0")}` }));
    const { user } = setup(eleven);
    await askToDelete(user, "Supplier 11");
    await user.click(screen.getByRole("button", { name: "Delete supplier" }));
    expect(await screen.findByText("Showing 1–10 of 10")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

describe("connecting", () => {
  it("offers Connect, as a link to the connect screen, for a supplier that is not connected", async () => {
    setup([acme]);
    const link = await screen.findByRole("link", { name: "Connect Acme Supply" });
    expect(link).toHaveAttribute("href", `/suppliers/${acme.id}/connect`);
    expect(link).toHaveTextContent("Connect");
    expect(screen.queryByRole("button", { name: /Check connection/ })).toBeNull();
  });

  it.each(["needs_reconnect", "blocked"] as const)("offers Reconnect supplier when the status is %s", async (sessionStatus) => {
    setup([aSupplier({ sessionStatus })]);
    const link = await screen.findByRole("link", { name: "Reconnect supplier Acme Supply" });
    expect(link).toHaveAttribute("href", `/suppliers/${acme.id}/connect`);
    expect(link).toHaveTextContent("Reconnect supplier");
    expect(screen.queryByRole("link", { name: /^Connect / })).toBeNull();
  });

  it("offers Check connection, not Connect, for a connected supplier", async () => {
    setup([aSupplier({ sessionStatus: "connected" })]);
    expect(await screen.findByRole("button", { name: "Check connection Acme Supply" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^(Connect|Reconnect supplier) Acme Supply$/ })).toBeNull();
  });

  it("still offers the right action for a paused supplier", async () => {
    setup([aSupplier({ enabled: false, pausedReason: "session", sessionStatus: "needs_reconnect" })]);
    expect(await screen.findByRole("link", { name: "Reconnect supplier Acme Supply" })).toBeInTheDocument();
  });
});

describe("checking a connection", () => {
  const connected = aSupplier({ sessionStatus: "connected" });

  it("shows a spinner on the button while the check is being asked for, then says it has started", async () => {
    let started!: () => void;
    const checkSession = vi.fn(() => new Promise<void>((resolve) => (started = resolve)));
    const { api, user } = setup([connected], { suppliers: { checkSession } });
    const button = await screen.findByRole("button", { name: "Check connection Acme Supply" });
    await user.click(button);
    expect(api.suppliers.checkSession).toHaveBeenCalledWith(connected.id);
    expect(button).toHaveAttribute("aria-busy", "true");
    started();
    expect(await screen.findByText("A check of Acme Supply has started. Its status will update in a moment.")).toBeInTheDocument();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("reads the page again a few seconds later, so the new status appears without a reload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      const page = vi
        .fn()
        .mockResolvedValueOnce({ items: [connected], total: 1, page: 1, pageSize: 10 })
        .mockResolvedValue({ items: [aSupplier({ sessionStatus: "needs_reconnect" })], total: 1, page: 1, pageSize: 10 });
      const { user } = setup([connected], { suppliers: { page } });
      await user.click(await screen.findByRole("button", { name: "Check connection Acme Supply" }));
      expect(page).toHaveBeenCalledTimes(1);
      await act(async () => void vi.advanceTimersByTime(4_500));
      expect(page).toHaveBeenCalledTimes(2);
      expect(await screen.findByRole("link", { name: "Reconnect supplier Acme Supply" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the server's plain message when the check cannot be started", async () => {
    const checkSession = vi.fn().mockRejectedValue(new ApiError("The check could not be started. Please try again in a minute.", 503, "check_not_started"));
    const { user } = setup([connected], { suppliers: { checkSession } });
    await user.click(await screen.findByRole("button", { name: "Check connection Acme Supply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The check could not be started. Please try again in a minute.");
  });

  it("does not leave a timer behind when the page is left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      const page = vi.fn().mockResolvedValue({ items: [connected], total: 1, page: 1, pageSize: 10 });
      const { user, unmount } = setup([connected], { suppliers: { page } });
      await user.click(await screen.findByRole("button", { name: "Check connection Acme Supply" }));
      unmount();
      await act(async () => void vi.advanceTimersByTime(10_000));
      expect(page).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("automatic checks", () => {
  const sid = acme.id;
  const scheduleRow = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({ supplierId: sid, status: { state: "off" }, intervalMinutes: null, window: null, nextCheckAt: null, run: null, lastRun: null, ...over });
  const cellOf = (name: string) => within(rowOf(name)).getByRole("cell", { name: /Automatic checks/ });
  const withSchedule = (rows: ScheduleRow[]) => setup([acme], { schedule: { overview: vi.fn().mockResolvedValue(rows) } });

  it("says automatic checks are off", async () => {
    withSchedule([scheduleRow()]);
    expect(await within(await screen.findByRole("table")).findByText("Automatic checks off")).toBeInTheDocument();
  });

  it("says how often and when the next check is", async () => {
    withSchedule([scheduleRow({ status: { state: "waiting" }, intervalMinutes: 1440, nextCheckAt: "2026-11-11T03:30:00.000Z" })]);
    expect(await screen.findByText(/Every day, next check/)).toBeInTheDocument();
  });

  it("says why a supplier is not being checked", async () => {
    withSchedule([scheduleRow({ status: { state: "not_checked", reason: "paused", message: "This supplier is paused. Resume it first." }, intervalMinutes: 360 })]);
    expect(await screen.findByText(/Not being checked/)).toBeInTheDocument();
    expect(screen.getByText(/This supplier is paused/)).toBeInTheDocument();
  });

  it("shows the last run's summary when nothing is running", async () => {
    withSchedule([scheduleRow({ status: { state: "waiting" }, intervalMinutes: 1440, nextCheckAt: "2026-11-11T03:30:00.000Z", lastRun: aRun() })]);
    expect(await screen.findByText("Checked 40 links, 3 cannot tell")).toBeInTheDocument();
  });

  it("shows progress while a run is going, reads it again every few seconds, then shows the summary", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      const running = scheduleRow({ status: { state: "running" }, intervalMinutes: 1440, run: aRun({ outcome: "running", endedAt: null, linksDone: 12, linksTotal: 40 }) });
      const done = scheduleRow({ status: { state: "waiting" }, intervalMinutes: 1440, nextCheckAt: "2026-11-11T03:30:00.000Z", lastRun: aRun() });
      const overview = vi.fn().mockResolvedValueOnce([running]).mockResolvedValue([done]);
      setup([acme], { schedule: { overview } });
      expect(await screen.findByText("Checking 12 of 40 links")).toBeInTheDocument();
      await act(async () => void vi.advanceTimersByTime(5_500));
      expect(overview).toHaveBeenCalledTimes(2);
      expect(await screen.findByText("Checked 40 links, 3 cannot tell")).toBeInTheDocument();
      await act(async () => void vi.advanceTimersByTime(20_000));
      expect(overview).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops reading the schedule when the page is left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      const overview = vi.fn().mockResolvedValue([scheduleRow({ status: { state: "running" }, run: aRun({ outcome: "running", endedAt: null }) })]);
      const { unmount } = setup([acme], { schedule: { overview } });
      await screen.findByText(/Checking/);
      unmount();
      await act(async () => void vi.advanceTimersByTime(20_000));
      expect(overview).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still shows the suppliers when the schedule cannot be read", async () => {
    setup([acme], { schedule: { overview: vi.fn().mockRejectedValue(new ApiError("No.", 500)) } });
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(cellOf("Acme Supply")).toBeInTheDocument();
  });
});
