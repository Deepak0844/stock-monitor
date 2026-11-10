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

const setup = (suppliers: Supplier[], over: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi({ ...over, suppliers: { list: vi.fn().mockResolvedValue(suppliers), ...over.suppliers } });
  const view = render(<SuppliersPage api={api} />);
  return { api, user: userEvent.setup(), unmount: view.unmount };
};

const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(name) });

describe("empty and loading", () => {
  it("shows a loading message first", () => {
    const api = fakeApi({ suppliers: { list: vi.fn().mockReturnValue(new Promise(() => {})) } });
    render(<SuppliersPage api={api} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("says plainly there are no suppliers and offers to add one", async () => {
    setup([]);
    expect(await screen.findByText("No suppliers yet. Add your first supplier.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add supplier" })).toHaveAttribute("href", "/suppliers/new");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a plain error and tries again when the list cannot load", async () => {
    const list = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0)).mockResolvedValue([acme]);
    const { user } = setup([], { suppliers: { list } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Acme Supply")).toBeInTheDocument();
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

  it("gives each action a name that includes the supplier, so a screen reader can tell them apart", async () => {
    setup([acme, globex]);
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: "Edit Acme Supply" })).toHaveAttribute("href", `/suppliers/${acme.id}/edit`);
    expect(screen.getByRole("button", { name: "Pause Globex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Globex" })).toBeInTheDocument();
  });
});

describe("pause and resume", () => {
  it("pauses one supplier and leaves the others alone", async () => {
    const { api, user } = setup([acme, globex]);
    await user.click(await screen.findByRole("button", { name: "Pause Acme Supply" }));
    expect(api.suppliers.pause).toHaveBeenCalledWith(acme.id);
    expect(await within(rowOf("Acme Supply")).findByText("Paused")).toBeInTheDocument();
    expect(within(rowOf("Acme Supply")).getByRole("button", { name: "Resume Acme Supply" })).toBeInTheDocument();
    expect(within(rowOf("Globex")).getByRole("button", { name: "Pause Globex" })).toBeInTheDocument();
  });

  it("resumes a paused supplier", async () => {
    const paused = aSupplier({ enabled: false, pausedReason: "owner" });
    const { api, user } = setup([paused]);
    await user.click(await screen.findByRole("button", { name: "Resume Acme Supply" }));
    expect(api.suppliers.resume).toHaveBeenCalledWith(paused.id);
    expect(await screen.findByRole("button", { name: "Pause Acme Supply" })).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("shows the server's plain message when pausing fails, and keeps the row as it was", async () => {
    const pause = vi.fn().mockRejectedValue(new ApiError("That supplier does not exist.", 404, "supplier_not_found"));
    const { user } = setup([acme], { suppliers: { pause } });
    await user.click(await screen.findByRole("button", { name: "Pause Acme Supply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That supplier does not exist.");
    expect(screen.getByRole("button", { name: "Pause Acme Supply" })).toBeEnabled();
  });
});

describe("delete", () => {
  it("asks first, names the supplier, and does nothing until confirmed", async () => {
    const { api, user } = setup([acme, globex]);
    await user.click(await screen.findByRole("button", { name: "Delete Acme Supply" }));
    const confirm = screen.getByRole("group", { name: "Confirm delete" });
    expect(confirm).toHaveTextContent("Delete Acme Supply?");
    expect(confirm).toHaveTextContent("cannot be undone");
    expect(api.suppliers.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("cancelling changes nothing", async () => {
    const { api, user } = setup([acme]);
    await user.click(await screen.findByRole("button", { name: "Delete Acme Supply" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm delete" })).toBeNull();
    expect(api.suppliers.remove).not.toHaveBeenCalled();
    expect(screen.getByText("Acme Supply")).toBeInTheDocument();
  });

  it("deletes after confirming, removes the row and says so", async () => {
    const { api, user } = setup([acme, globex]);
    await user.click(await screen.findByRole("button", { name: "Delete Acme Supply" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(api.suppliers.remove).toHaveBeenCalledWith(acme.id);
    await waitFor(() => expect(screen.queryByText("Acme Supply", { selector: "td" })).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Deleted Acme Supply.");
    expect(screen.getByText("Globex")).toBeInTheDocument();
  });

  it("shows the empty state after the last supplier is deleted", async () => {
    const { user } = setup([acme]);
    await user.click(await screen.findByRole("button", { name: "Delete Acme Supply" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByText("No suppliers yet. Add your first supplier.")).toBeInTheDocument();
  });

  it("keeps the supplier and shows the message when deleting fails", async () => {
    const remove = vi.fn().mockRejectedValue(new ApiError("Something went wrong. Please try again.", 500));
    const { user } = setup([acme], { suppliers: { remove } });
    await user.click(await screen.findByRole("button", { name: "Delete Acme Supply" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("Acme Supply")).toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: /Connect|Reconnect/ })).toBeNull();
  });

  it("still offers the right action for a paused supplier", async () => {
    setup([aSupplier({ enabled: false, pausedReason: "session", sessionStatus: "needs_reconnect" })]);
    expect(await screen.findByRole("link", { name: "Reconnect supplier Acme Supply" })).toBeInTheDocument();
  });

  it("puts the connect action first in each row", async () => {
    setup([aSupplier({ sessionStatus: "needs_reconnect" })]);
    await screen.findByRole("table");
    const actions = within(screen.getByRole("row", { name: /Acme Supply/ })).getAllByRole("link").concat(within(screen.getByRole("row", { name: /Acme Supply/ })).getAllByRole("button"));
    expect(actions.map((a) => a.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining(["Reconnect supplier Acme Supply", "Edit Acme Supply", "Pause Acme Supply", "Delete Acme Supply"]),
    );
    const first = within(screen.getByRole("row", { name: /Acme Supply/ })).getByRole("cell", { name: /Reconnect supplier/ });
    expect(first).toBeInTheDocument();
  });
});

describe("checking a connection", () => {
  const connected = aSupplier({ sessionStatus: "connected" });

  it("asks for a check, and says plainly that it has started", async () => {
    const { api, user } = setup([connected]);
    await user.click(await screen.findByRole("button", { name: "Check connection Acme Supply" }));
    expect(api.suppliers.checkSession).toHaveBeenCalledWith(connected.id);
    expect(await screen.findByText("A check of Acme Supply has started. Its status will update in a moment.")).toBeInTheDocument();
  });

  it("reads the list again a few seconds later, so the new status appears without a reload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      const list = vi.fn().mockResolvedValueOnce([connected]).mockResolvedValue([aSupplier({ sessionStatus: "needs_reconnect" })]);
      const { user } = setup([], { suppliers: { list } });
      await user.click(await screen.findByRole("button", { name: "Check connection Acme Supply" }));
      expect(list).toHaveBeenCalledTimes(1);
      await act(async () => void vi.advanceTimersByTime(4_500));
      expect(list).toHaveBeenCalledTimes(2);
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
      const list = vi.fn().mockResolvedValue([connected]);
      const { user, unmount } = setup([], { suppliers: { list } });
      await user.click(await screen.findByRole("button", { name: "Check connection Acme Supply" }));
      unmount();
      await act(async () => void vi.advanceTimersByTime(10_000));
      expect(list).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stock rules link", () => {
  it("each supplier row links to its stock rules", async () => {
    setup([acme]);
    expect(await screen.findByRole("link", { name: "Stock rules Acme Supply" })).toHaveAttribute("href", `/suppliers/${acme.id}/rules`);
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
