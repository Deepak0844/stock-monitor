// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../api.js";
import { aMapping, aNotification, aSupplier, fakeApi } from "../test/fake-api.js";
import { DashboardPage } from "./DashboardPage.js";

afterEach(cleanup);

const setup = (over: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi(over);
  render(<DashboardPage api={api} />);
  return { api, user: userEvent.setup() };
};
const card = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;

describe("DashboardPage", () => {
  it("has one page heading, Dashboard, with a plain-words description", async () => {
    setup();
    await screen.findByText("Nothing needs your attention.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/what needs your approval/i)).toBeInTheDocument();
  });

  it.each([
    ["Stock checks", /no checks scheduled/i],
    ["Waiting for your approval", /nothing to review/i],
  ])("shows an honest empty state for %s", async (heading, message) => {
    setup();
    await screen.findByText("Nothing needs your attention.");
    expect(within(card(heading)).getByText(message)).toBeInTheDocument();
  });

  it("explains the four steps of how it works, in order", async () => {
    setup();
    await screen.findByText("Nothing needs your attention.");
    const steps = within(screen.getByRole("list", { name: "How it works" })).getAllByRole("listitem");
    expect(steps.map((s) => s.querySelector("strong")?.textContent)).toEqual(["Check suppliers", "Propose changes", "You approve", "Update Shopify"]);
  });

  it("promises that nothing reaches Shopify without approval", async () => {
    setup();
    await screen.findByText("Nothing needs your attention.");
    expect(screen.getByText(/only approved changes are sent/i)).toBeInTheDocument();
  });
});

describe("Needs attention", () => {
  it("says plainly that nothing needs attention when nothing does", async () => {
    setup();
    expect(await within(card("Needs attention")).findByText("Nothing needs your attention.")).toBeInTheDocument();
    expect(within(card("Needs attention")).queryByRole("link")).toBeNull();
  });

  it("shows loading first", () => {
    setup({ notifications: { list: vi.fn().mockReturnValue(new Promise(() => {})) } });
    expect(within(card("Needs attention")).getByRole("status")).toHaveTextContent("Loading…");
  });

  it("lists each message in plain words with a Reconnect supplier button that goes to the connect screen", async () => {
    const other = aNotification({ id: "n2", supplierId: "22222222-2222-4222-8222-222222222222", supplierName: "Globex", message: "Globex is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it.", reason: "captcha" });
    setup({ notifications: { list: vi.fn().mockResolvedValue([aNotification(), other]) } });
    const items = within(await within(card("Needs attention")).findByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Acme Supply needs you to log in again.");
    expect(within(items[0]!).getByRole("link", { name: "Reconnect supplier Acme Supply" })).toHaveAttribute("href", "/suppliers/11111111-1111-4111-8111-111111111111/connect");
    expect(items[1]).toHaveTextContent("Globex is asking you to solve a puzzle");
    expect(within(items[1]!).getByRole("link", { name: "Reconnect supplier Globex" })).toHaveAttribute("href", "/suppliers/22222222-2222-4222-8222-222222222222/connect");
  });

  it("comes before the summary cards, because it is what the owner should act on", async () => {
    setup({ notifications: { list: vi.fn().mockResolvedValue([aNotification()]) } });
    await screen.findByText("Acme Supply needs you to log in again.");
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(order[0]).toBe("Needs attention");
  });

  it("shows a plain message and Try again when the messages cannot be loaded", async () => {
    const list = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0)).mockResolvedValue([aNotification()]);
    const { user } = setup({ notifications: { list } });
    expect(await within(card("Needs attention")).findByRole("alert")).toHaveTextContent("Can't reach the server");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Acme Supply needs you to log in again.")).toBeInTheDocument();
  });
});

describe("Supplier connections", () => {
  it("says there are none, in plain words, when there are none", async () => {
    setup();
    expect(await within(card("Supplier connections")).findByText(/no suppliers yet/i)).toBeInTheDocument();
  });

  it("counts the suppliers that are connected", async () => {
    const list = vi.fn().mockResolvedValue([
      aSupplier({ id: "a", name: "A", sessionStatus: "connected" }),
      aSupplier({ id: "b", name: "B", sessionStatus: "needs_reconnect" }),
      aSupplier({ id: "c", name: "C", sessionStatus: "not_connected" }),
    ]);
    setup({ suppliers: { list } });
    const summary = card("Supplier connections");
    expect(await within(summary).findByText("1 of 3")).toBeInTheDocument();
    expect(within(summary).getByText("suppliers connected.")).toBeInTheDocument();
  });

  describe("supplier links card", () => {
    it("says how many variants are not mapped and how many links need attention", async () => {
      setup({
        mappings: {
          unmapped: vi.fn().mockResolvedValue({ total: 340, unmapped: 212, items: [] }),
          list: vi.fn().mockResolvedValue([
            aMapping({ id: "a", linkStatus: "never_worked" }),
            aMapping({ id: "b", linkStatus: "page_missing" }),
            aMapping({ id: "c", linkStatus: "moved" }),
            aMapping({ id: "d", linkStatus: "works" }),
            aMapping({ id: "e", linkStatus: "needs_login" }),
          ]),
        },
      });
      const c = within(await screen.findByRole("heading", { level: 2, name: "Supplier links" }).then((h) => h.closest("section")!));
      expect(await c.findByText("212 of 340")).toBeInTheDocument();
      expect(c.getByText(/variants not mapped\. 3 links need attention\./)).toBeInTheDocument();
      expect(c.getByRole("link", { name: "See links" })).toHaveAttribute("href", "/mappings");
    });

    it("says so when Shopify has no variants yet", async () => {
      setup();
      const c = within(await screen.findByRole("heading", { level: 2, name: "Supplier links" }).then((h) => h.closest("section")!));
      expect(await c.findByText("No variants from Shopify yet.")).toBeInTheDocument();
    });

    it("says it could not load, without breaking the rest of the page", async () => {
      setup({ mappings: { unmapped: vi.fn().mockRejectedValue(new ApiError("x", 500)) } });
      expect(await screen.findByText("Could not load links.")).toBeInTheDocument();
      expect(screen.getByText("Nothing needs your attention.")).toBeInTheDocument();
    });
  });
});
