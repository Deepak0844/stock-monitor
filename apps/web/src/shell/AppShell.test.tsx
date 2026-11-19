// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AppShell } from "./AppShell.js";
import { navigate } from "../router.js";
import type { NotificationsState } from "./useNotifications.js";

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

const quiet: NotificationsState = {
  items: [],
  unread: 0,
  loading: false,
  error: null,
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  reload: vi.fn(),
};
const setup = (onSignOut = vi.fn(), proposalCount?: number, attentionCount?: number) => {
  render(
    <AppShell
      email="owner@example.com"
      onSignOut={onSignOut}
      proposalCount={proposalCount}
      attentionCount={attentionCount}
      notifications={quiet}
    >
      <h1>Page title</h1>
    </AppShell>,
  );
  return { onSignOut, user: userEvent.setup() };
};

describe("AppShell", () => {
  it("starts with a skip link that jumps to the main content", () => {
    setup();
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("marks Dashboard as the current page", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("has no History item: past suggestions live under Proposals", () => {
    setup();
    expect(
      within(screen.getByRole("navigation", { name: "Main" })).queryByText("History"),
    ).toBeNull();
  });

  it("makes Suppliers a real link to the suppliers page, and marks it current there and on its sub pages", () => {
    window.history.replaceState(null, "", "/suppliers/new");
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const link = within(nav).getByRole("link", { name: "Suppliers" });
    expect(link).toHaveAttribute("href", "/suppliers");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("makes Products a real link to the products page, and marks it current there", () => {
    window.history.replaceState(null, "", "/products");
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const link = within(nav).getByRole("link", { name: "Products" });
    expect(link).toHaveAttribute("href", "/products");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps the sections in a sensible order", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const labels = within(nav)
      .getAllByRole("listitem")
      .map((li) => li.textContent?.replace("Soon", "").trim());
    expect(labels).toEqual([
      "Dashboard",
      "Suppliers",
      "Links",
      "Products",
      "Proposals",
      "Settings",
    ]);
  });

  it("makes Proposals a real link, with no badge when nothing is waiting", () => {
    setup(vi.fn(), 0);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const link = within(nav).getByRole("link", { name: "Proposals" });
    expect(link).toHaveAttribute("href", "/proposals");
    expect(link.querySelector("[data-count]")).toBeNull();
  });

  it("shows how many things need attention beside Dashboard, and says so to a screen reader", () => {
    setup(undefined, undefined, 2);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav).getByRole("link", { name: "Dashboard, 2 need attention" }),
    ).toBeInTheDocument();
  });

  it("shows no Dashboard badge when nothing needs attention", () => {
    setup(undefined, undefined, 0);
    expect(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", {
        name: "Dashboard",
      }),
    ).toBeInTheDocument();
  });

  it("shows how many suggestions are waiting, and says so to a screen reader", () => {
    setup(vi.fn(), 3);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const link = within(nav).getByRole("link", { name: "Proposals, 3 waiting" });
    expect(link).toHaveTextContent("3");
    expect(link).toHaveAttribute("href", "/proposals");
  });

  it("makes Settings a real link to the Shopify settings page", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings/shopify",
    );
  });

  it("marks Settings, not Dashboard, as current on a settings page", () => {
    window.history.replaceState(null, "", "/settings/shopify");
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("moves keyboard focus to the page content after moving to another page", async () => {
    setup();
    expect(screen.getByRole("main")).not.toHaveFocus();
    act(() => navigate("/settings/shopify"));
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("shows who is signed in and signs out on request", async () => {
    const { onSignOut, user } = setup();
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(within(screen.getByRole("menu")).getByText("owner@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows the owner's initials on the Account button, and its menu offers the three themes and Account settings", async () => {
    const { user } = setup();
    expect(screen.getByRole("button", { name: "Account" })).toHaveTextContent("OW");
    await user.click(screen.getByRole("button", { name: "Account" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((i) => i.textContent),
    ).toEqual(["Light", "Dark", "Same as device"]);
    expect(within(menu).getByRole("menuitem", { name: "Account settings" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("menuitemradio", { name: "Same as device" }));
    expect(localStorage.getItem("theme") ?? "system").toBe("system");
    document.documentElement.classList.remove("dark", "light");
  });

  it("opens Account settings from the menu", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Account settings" }));
    expect(window.location.pathname).toBe("/settings/account");
  });

  it("shows the page inside the main area", () => {
    setup();
    expect(
      within(screen.getByRole("main")).getByRole("heading", { name: "Page title" }),
    ).toBeInTheDocument();
  });
});

describe("AppShell top bar", () => {
  it("shows the breadcrumb trail for the page and a notification bell", () => {
    window.history.replaceState(null, "", "/suppliers/new");
    setup();
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByRole("link", { name: "Suppliers" })).toHaveAttribute(
      "href",
      "/suppliers",
    );
    expect(within(trail).getByText("Add supplier")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Notifications, none unread" })).toBeInTheDocument();
  });

  it("has one place to change the theme: the Account menu, not a separate button or an Appearance item", async () => {
    const { user } = setup();
    expect(screen.queryByRole("button", { name: "Dark theme" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.queryByRole("menuitem", { name: "Appearance" })).toBeNull();
    document.documentElement.classList.remove("dark", "light");
  });
});
