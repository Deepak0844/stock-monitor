// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { getPreference, resetPreferencesForTests } from "../../lib/preferences.js";
import { getTheme } from "../../lib/theme.js";
import { App } from "../../App.js";
import { fakeApi } from "../../test/fake-api.js";
import { AccountPage } from "./AccountPage.js";
import { AppearancePage } from "./AppearancePage.js";
import { SettingsLayout } from "./SettingsLayout.js";

beforeEach(() => {
  localStorage.clear();
  resetPreferencesForTests();
  document.documentElement.classList.remove("dark", "light");
});
afterEach(cleanup);

describe("SettingsLayout", () => {
  it("has a side menu with each part of Settings, and marks the one showing", () => {
    render(
      <SettingsLayout current="appearance">
        <p>Body</p>
      </SettingsLayout>,
    );
    const menu = screen.getByRole("navigation", { name: "Settings" });
    expect(within(menu).getAllByRole("link").map((l) => l.textContent)).toEqual(["Shopify", "Stock suggestions", "Appearance", "Account"]);
    expect(within(menu).getByRole("link", { name: "Appearance" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: "Stock suggestions" })).toHaveAttribute("href", "/settings/suggestions");
  });
});

describe("AppearancePage", () => {
  it("switches to the dark theme and remembers it", async () => {
    render(<AppearancePage />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(getTheme()).toBe("dark");
    await userEvent.click(screen.getByRole("radio", { name: "Follow my device" }));
    expect(getTheme()).toBe("system");
  });

  it("chooses compact rows, and can hide the check status in the sidebar", async () => {
    render(<AppearancePage />);
    await userEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(getPreference("rows")).toBe("compact");
    const toggle = screen.getByRole("switch", { name: "Show check status in the sidebar" });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(getPreference("checkStatus")).toBe(false);
  });
});

describe("AccountPage", () => {
  it("shows who is signed in and signs out", async () => {
    const onSignOut = vi.fn();
    render(<AccountPage email="owner@example.com" onSignOut={onSignOut} />);
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("settings addresses", () => {
  const signedIn = () => fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" }) });
  it.each([
    ["/settings/suggestions", "Stock suggestions"],
    ["/settings/appearance", "Appearance"],
    ["/settings/account", "Account"],
  ])("%s opens its own part of Settings", async (path, item) => {
    window.history.replaceState(null, "", path);
    render(<App api={signedIn()} />);
    const menu = await screen.findByRole("navigation", { name: "Settings" });
    expect(within(menu).getByRole("link", { name: item })).toHaveAttribute("aria-current", "page");
  });
});
