// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError, type ScheduleRow } from "../api.js";
import { aRun, aSupplier, fakeApi } from "../test/fake-api.js";
import { SchedulePanel } from "./SchedulePanel.js";

afterEach(cleanup);
const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({ supplierId: aSupplier().id, status: { state: "off" }, intervalMinutes: null, window: null, nextCheckAt: null, run: null, lastRun: null, ...over });
const setup = (supplier = aSupplier(), over: Parameters<typeof fakeApi>[0] = {}, rows: ScheduleRow[] = [row()]) => {
  const api = fakeApi({ ...over, schedule: { overview: vi.fn().mockResolvedValue(rows), ...over.schedule } });
  render(<SchedulePanel api={api} supplier={supplier} />);
  return { api, user: userEvent.setup() };
};

describe("Automatic checks panel", () => {
  it("starts off, with the quiet hours filled in with the default 07:00 to 22:00", async () => {
    setup();
    expect(await screen.findByLabelText("How often")).toHaveValue("off");
    expect(screen.getByLabelText("From")).toHaveValue("07:00");
    expect(screen.getByLabelText("Until")).toHaveValue("22:00");
    expect(screen.getByLabelText("Any time of day")).not.toBeChecked();
  });

  it("turns checks on daily with the default hours, and says it was saved", async () => {
    const { api, user } = setup();
    await user.selectOptions(await screen.findByLabelText("How often"), "1440");
    await user.click(screen.getByRole("button", { name: "Save automatic checks" }));
    expect(api.schedule.set).toHaveBeenCalledWith(aSupplier().id, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" } });
    expect(await screen.findByText("Automatic checks saved.")).toBeInTheDocument();
  });

  it("sends no window when 'any time of day' is ticked", async () => {
    const { api, user } = setup();
    await user.selectOptions(await screen.findByLabelText("How often"), "360");
    await user.click(screen.getByLabelText("Any time of day"));
    expect(screen.getByLabelText("From")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save automatic checks" }));
    expect(api.schedule.set).toHaveBeenCalledWith(aSupplier().id, { intervalMinutes: 360, window: null });
  });

  it("shows the saved settings of a supplier that is on, and sends off as null", async () => {
    const supplier = aSupplier({ scheduleIntervalMinutes: 720, scheduleWindowStart: "08:00", scheduleWindowEnd: "20:00" });
    const { api, user } = setup(supplier, {}, [row({ intervalMinutes: 720, window: { start: "08:00", end: "20:00" }, status: { state: "waiting" }, nextCheckAt: "2026-11-11T03:30:00.000Z" })]);
    expect(await screen.findByLabelText("How often")).toHaveValue("720");
    expect(screen.getByLabelText("From")).toHaveValue("08:00");
    // The schedule row loads after the supplier, so wait for it.
    expect(await screen.findByText(/Next check:/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("How often"), "off");
    await user.click(screen.getByRole("button", { name: "Save automatic checks" }));
    expect(api.schedule.set).toHaveBeenCalledWith(supplier.id, { intervalMinutes: null, window: { start: "08:00", end: "20:00" } });
  });

  it("shows any time of day ticked for a supplier that is on with no window", async () => {
    setup(aSupplier({ scheduleIntervalMinutes: 60 }), {}, [row({ intervalMinutes: 60, status: { state: "waiting" } })]);
    expect(await screen.findByLabelText("Any time of day")).toBeChecked();
  });

  it("says why checks are not running when the supplier is not ready", async () => {
    setup(aSupplier({ scheduleIntervalMinutes: 1440 }), {}, [row({ intervalMinutes: 1440, status: { state: "not_checked", reason: "no_permission", message: "You have not recorded permission to check this supplier automatically. Open the supplier to record it." } })]);
    expect(await screen.findByText(/not being checked/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded permission/)).toBeInTheDocument();
  });

  it("refuses a window that starts and ends at the same time, without asking the server", async () => {
    const { api, user } = setup();
    await user.selectOptions(await screen.findByLabelText("How often"), "1440");
    await user.clear(screen.getByLabelText("Until"));
    await user.type(screen.getByLabelText("Until"), "07:00");
    await user.click(screen.getByRole("button", { name: "Save automatic checks" }));
    expect(await screen.findByText(/different/)).toBeInTheDocument();
    expect(api.schedule.set).not.toHaveBeenCalled();
  });

  it("shows the server's plain message when saving fails", async () => {
    const set = vi.fn().mockRejectedValue(new ApiError("Choose how often to check.", 400, "invalid_schedule"));
    const { user } = setup(aSupplier(), { schedule: { set } });
    await user.selectOptions(await screen.findByLabelText("How often"), "60");
    await user.click(screen.getByRole("button", { name: "Save automatic checks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose how often to check.");
  });

  it("lists the recent runs with plain summaries", async () => {
    const runs = vi.fn().mockResolvedValue([aRun(), aRun({ id: "x", trigger: "manual", outcome: "stopped", stopReason: "captcha", linksDone: 2, cannotTell: 0, startedAt: "2026-11-09T08:00:00.000Z" })]);
    setup(aSupplier(), { schedule: { runs } });
    expect(await screen.findByText("Checked 40 links, 3 cannot tell")).toBeInTheDocument();
    expect(screen.getByText(/Stopped after 2 of 40 links. The supplier showed a puzzle/)).toBeInTheDocument();
    expect(screen.getByText("By you")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    await waitFor(() => expect(runs).toHaveBeenCalledWith(aSupplier().id));
  });

  it("says plainly when there are no runs yet", async () => {
    setup();
    expect(await screen.findByText("No checks have run yet.")).toBeInTheDocument();
  });
});
