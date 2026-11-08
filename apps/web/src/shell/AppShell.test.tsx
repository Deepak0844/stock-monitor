// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AppShell } from "./AppShell.js";
import { navigate } from "../router.js";

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

const setup = (onSignOut = vi.fn()) => {
  render(
    <AppShell email="owner@example.com" onSignOut={onSignOut}>
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

  it.each(["Approvals", "History"])(
    "shows %s as not available yet instead of a dead link",
    (label) => {
      setup();
      const nav = screen.getByRole("navigation", { name: "Main" });
      expect(within(nav).queryByRole("link", { name: new RegExp(label) })).toBeNull();
      const item = within(nav).getByText(label).closest("[aria-disabled]");
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveTextContent("Soon");
    },
  );

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
    expect(labels).toEqual(["Dashboard", "Suppliers", "Products", "Approvals", "History", "Settings"]);
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
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("opens and closes the navigation from the Menu button on small screens", async () => {
    const { user } = setup();
    const menu = screen.getByRole("button", { name: "Menu" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveAttribute("aria-controls", nav.id);
    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the menu once a link has taken the owner to another page", async () => {
    const { user } = setup();
    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Settings" }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the menu when Escape is pressed", async () => {
    const { user } = setup();
    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    await user.keyboard("{Escape}");
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the page inside the main area", () => {
    setup();
    expect(within(screen.getByRole("main")).getByRole("heading", { name: "Page title" })).toBeInTheDocument();
  });
});
