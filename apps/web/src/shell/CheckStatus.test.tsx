// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ScheduleRow } from "../api.js";
import { resetPreferencesForTests, setPreference } from "../lib/preferences.js";
import { checkStatusOf } from "./checkSummary.js";
import { CheckStatus } from "./CheckStatus.js";

const row = (over: Partial<ScheduleRow>): ScheduleRow => ({
  supplierId: "s1",
  status: { state: "waiting" },
  intervalMinutes: 30,
  window: null,
  nextCheckAt: "2026-11-19T09:28:00",
  run: null,
  lastRun: null,
  recent: { total: 0, finished: 0, failed: 0, stopped: 0, streak: null },
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  resetPreferencesForTests();
});
afterEach(cleanup);

describe("checkStatusOf", () => {
  it("is off with nothing scheduled", () => {
    expect(checkStatusOf([])).toEqual({ on: false, nextAt: null, stopped: 0 });
  });

  it("takes the earliest next check and counts suppliers that are not being checked", () => {
    const rows = [
      row({ supplierId: "a", nextCheckAt: "2026-11-19T10:12:00" }),
      row({ supplierId: "b", nextCheckAt: "2026-11-19T09:28:00" }),
      row({ supplierId: "c", status: { state: "not_checked", reason: "needs_reconnect", message: "Reconnect" }, nextCheckAt: null }),
      row({ supplierId: "d", intervalMinutes: null, status: { state: "off" }, nextCheckAt: "2026-11-19T08:00:00" }),
    ];
    expect(checkStatusOf(rows)).toEqual({ on: true, nextAt: "2026-11-19T09:28:00", stopped: 1 });
  });
});

describe("CheckStatus", () => {
  it("says checks are on, when the next one is, and how many suppliers stopped", () => {
    render(<CheckStatus rows={[row({}), row({ supplierId: "c", status: { state: "not_checked", reason: "needs_reconnect", message: "Reconnect" }, nextCheckAt: null })]} />);
    expect(screen.getByText(/On · next at/)).toHaveTextContent("On · next at 09:28");
    expect(screen.getByText("1 supplier stopped")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See suppliers" })).toHaveAttribute("href", "/suppliers");
  });

  it("says Off when no supplier has automatic checks", () => {
    render(<CheckStatus rows={[row({ intervalMinutes: null, status: { state: "off" }, nextCheckAt: null })]} />);
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.queryByText(/stopped/)).not.toBeInTheDocument();
  });

  it("shows nothing while loading or when turned off in Appearance", () => {
    const { container, rerender } = render(<CheckStatus rows={null} />);
    expect(container).toBeEmptyDOMElement();
    setPreference("checkStatus", false);
    rerender(<CheckStatus rows={[row({})]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
