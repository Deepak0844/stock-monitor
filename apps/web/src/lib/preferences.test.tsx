// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { getPreference, resetPreferencesForTests, setPreference, usePreference } from "./preferences.js";

beforeEach(() => {
  localStorage.clear();
  resetPreferencesForTests();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("preferences", () => {
  it("gives the defaults when nothing is saved", () => {
    expect(getPreference("rows")).toBe("comfortable");
    expect(getPreference("checkStatus")).toBe(true);
  });

  it("returns what was set, and saves it on the device", () => {
    setPreference("rows", "compact");
    expect(getPreference("rows")).toBe("compact");
    resetPreferencesForTests();
    expect(getPreference("rows")).toBe("compact");
  });

  it("tells every hook in the tab when a value changes", () => {
    function Show() {
      const [rows] = usePreference("rows");
      return <p>{rows}</p>;
    }
    render(<Show />);
    expect(screen.getByText("comfortable")).toBeInTheDocument();
    act(() => setPreference("rows", "compact"));
    expect(screen.getByText("compact")).toBeInTheDocument();
  });

  it("falls back to the defaults without crashing when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getPreference("rows")).toBe("comfortable");
    expect(() => setPreference("rows", "compact")).not.toThrow();
    expect(getPreference("rows")).toBe("compact");
  });

  it("ignores a broken saved value", () => {
    localStorage.setItem("stock-monitor:prefs", "{not json");
    expect(getPreference("rows")).toBe("comfortable");
  });

  it("ignores a saved value that is not one of the choices", () => {
    localStorage.setItem("stock-monitor:prefs", JSON.stringify({ rows: "huge", checkStatus: "yes" }));
    expect(getPreference("rows")).toBe("comfortable");
    expect(getPreference("checkStatus")).toBe(true);
  });
});
