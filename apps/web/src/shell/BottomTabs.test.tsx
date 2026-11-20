// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AppShell } from "./AppShell.js";
import type { NotificationsState } from "./useNotifications.js";

// A phone-sized screen: below the 1024px line.
const phone = () =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  phone();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const quiet: NotificationsState = {
  items: [],
  unread: 0,
  loading: false,
  error: null,
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  reload: vi.fn(),
};
const setup = (onSignOut = vi.fn()) => {
  render(
    <AppShell
      email="owner@example.com"
      onSignOut={onSignOut}
      proposalCount={12}
      attentionCount={2}
      notifications={quiet}
    >
      <h1>Page title</h1>
    </AppShell>,
  );
  return { onSignOut, user: userEvent.setup() };
};

describe("phone tabs", () => {
  it("has five tabs at the bottom, with the current page marked", () => {
    setup();
    const tabs = screen.getByRole("navigation", { name: "Main" });
    const links = within(tabs).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/\d+/g, "").trim())).toEqual([
      "Dashboard",
      "Links",
      "Proposals",
      "Suppliers",
    ]);
    expect(within(tabs).getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(within(tabs).getByRole("link", { name: /^Dashboard/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("tells a screen reader how many proposals are waiting", () => {
    setup();
    expect(screen.getByRole("link", { name: "Proposals, 12 waiting" })).toHaveAttribute(
      "href",
      "/proposals",
    );
    expect(screen.getByRole("link", { name: "Dashboard, 2 need attention" })).toBeInTheDocument();
  });

  it("has no sidebar and no Menu button on a phone", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("opens More with Products, Settings and Sign out, and Escape puts focus back on More", async () => {
    const { user, onSignOut } = setup();
    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(within(sheet).getByRole("link", { name: "Products" })).toHaveAttribute(
      "href",
      "/products",
    );
    expect(within(sheet).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings/shopify",
    );
    expect(within(sheet).getByText("owner@example.com")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    await user.click(more);
    await user.click(
      within(screen.getByRole("dialog", { name: "More" })).getByRole("button", {
        name: "Sign out",
      }),
    );
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("closes More once a link in it has been followed", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "More" })).getByRole("link", { name: "Products" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
  });
});
