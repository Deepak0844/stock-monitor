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

const quiet: NotificationsState = { items: [], unread: 0, loading: false, error: null, markRead: vi.fn(), markAllRead: vi.fn(), reload: vi.fn() };
const setup = (onSignOut = vi.fn(), proposalCount?: number, attentionCount?: number) => {
  render(
    <AppShell email="owner@example.com" onSignOut={onSignOut} proposalCount={proposalCount} attentionCount={attentionCount} notifications={quiet}>
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
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("has no History item: past suggestions live under Proposals", () => {
    setup();
    expect(within(screen.getByRole("navigation", { name: "Main" })).queryByText("History")).toBeNull();
  });

  it("makes Suppliers a real link to the suppliers page, and marks it current there and on its sub pages", () => {
    window.history.replaceState(null, "", "/suppliers/new");
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const link = within(nav).getByRole("link", { name: "Suppliers" });
    expect(link).toHaveAttribute("href", "/suppliers");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("makes Products a real link to the products page, and marks it current there", () => {
    window.history.replaceState(null, "", "/products");
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const link = within(nav).getByRole("link", { name: "Products" });
    expect(link).toHaveAttribute("href", "/products");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the sections in a sensible order", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const labels = within(nav).getAllByRole("listitem").map((li) => li.textContent?.replace("Soon", "").trim());
    expect(labels).toEqual(["Dashboard", "Suppliers", "Links", "Products", "Proposals", "Settings"]);
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
    expect(within(nav).getByRole("link", { name: "Dashboard, 2 need attention" })).toBeInTheDocument();
  });

  it("shows no Dashboard badge when nothing needs attention", () => {
    setup(undefined, undefined, 0);
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
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
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/shopify");
  });

  it("marks Settings, not Dashboard, as current on a settings page", () => {
    window.history.replaceState(null, "", "/settings/shopify");
    setup();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
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




  it("shows the page inside the main area", () => {
    setup();
    expect(within(screen.getByRole("main")).getByRole("heading", { name: "Page title" })).toBeInTheDocument();
  });
});

describe("AppShell top bar", () => {
  it("shows the breadcrumb trail for the page and a notification bell", () => {
    window.history.replaceState(null, "", "/suppliers/new");
    setup();
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByRole("link", { name: "Suppliers" })).toHaveAttribute("href", "/suppliers");
    expect(within(trail).getByText("Add supplier")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Notifications, none unread" })).toBeInTheDocument();
  });

  it("has a theme button whose name stays the same and whose pressed state says which theme is on", async () => {
    const { user } = setup();
    const button = screen.getByRole("button", { name: "Dark theme" });
    const before = button.getAttribute("aria-pressed");
    expect(["true", "false"]).toContain(before);
    await user.click(button);
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    expect(document.documentElement.classList.contains("dark")).toBe(before !== "true");
    document.documentElement.classList.remove("dark", "light");
  });
});
