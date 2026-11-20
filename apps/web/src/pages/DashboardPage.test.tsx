// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../api.js";
import { aMapping, aNotification, aProposal, aSupplier, fakeApi } from "../test/fake-api.js";
import { renderWithStore } from "../test/renderWithStore.js";
import { DashboardPage } from "./DashboardPage.js";

afterEach(cleanup);

const setup = (over: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi(over);
  renderWithStore(<DashboardPage api={api} />, { api });
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

  it("shows how many suppliers have automatic checks on and when the next one is", async () => {
    const next = "2030-01-02T09:00:00.000Z";
    const row = (supplierId: string, over = {}) => ({
      supplierId,
      status: { state: "waiting" as const },
      intervalMinutes: 1440,
      window: null,
      nextCheckAt: next,
      run: null,
      lastRun: null,
      recent: { total: 0, finished: 0, failed: 0, stopped: 0, streak: null },
      ...over,
    });
    setup({
      schedule: {
        overview: vi
          .fn()
          .mockResolvedValue([
            row("a"),
            row("b", { nextCheckAt: "2030-01-03T09:00:00.000Z" }),
            row("c", { intervalMinutes: null, status: { state: "off" }, nextCheckAt: null }),
          ]),
      },
    });
    await screen.findByText("Nothing needs your attention.");
    const c = card("Stock checks");
    expect(await within(c).findByText("2 suppliers")).toBeInTheDocument();
    expect(within(c).getByText(/next check/i)).toBeInTheDocument();
  });

  it("says a check is running now", async () => {
    setup({
      schedule: {
        overview: vi.fn().mockResolvedValue([
          {
            supplierId: "a",
            status: { state: "running" },
            intervalMinutes: 60,
            window: null,
            nextCheckAt: null,
            run: null,
            lastRun: null,
            recent: { total: 0, finished: 0, failed: 0, stopped: 0, streak: null },
          },
        ]),
      },
    });
    await screen.findByText("Nothing needs your attention.");
    expect(await within(card("Stock checks")).findByText(/checking now/i)).toBeInTheDocument();
  });

  it("shows how many suggestions are waiting and links to them", async () => {
    setup({ proposals: { count: vi.fn().mockResolvedValue(3) } });
    await screen.findByText("Nothing needs your attention.");
    const c = card("Waiting for your approval");
    expect(await within(c).findByText("3")).toBeInTheDocument();
    expect(within(c).getByRole("link", { name: "Review suggestions" })).toHaveAttribute(
      "href",
      "/proposals",
    );
  });

  it("shows a change that was not applied, with a link to Proposals", async () => {
    setup({
      notifications: {
        list: vi.fn().mockResolvedValue([
          aNotification({
            kind: "proposal_needs_attention",
            message:
              "A stock change was not applied because Shopify's number changed. Open Proposals to refresh it.",
          }),
        ]),
      },
    });
    expect(await screen.findByText(/A stock change was not applied/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See proposals" })).toHaveAttribute(
      "href",
      "/proposals",
    );
    expect(screen.queryByRole("link", { name: /Reconnect supplier/ })).toBeNull();
  });

  it("explains the four steps of how it works, in order", async () => {
    setup();
    await screen.findByText("Nothing needs your attention.");
    const steps = within(screen.getByRole("list", { name: "How it works" })).getAllByRole(
      "listitem",
    );
    expect(steps.map((s) => s.querySelector("strong")?.textContent)).toEqual([
      "Check suppliers",
      "Propose changes",
      "You approve",
      "Update Shopify",
    ]);
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
    expect(
      await within(card("Needs attention")).findByText("Nothing needs your attention."),
    ).toBeInTheDocument();
    expect(within(card("Needs attention")).queryByRole("link")).toBeNull();
  });

  it("shows loading first", () => {
    setup({ notifications: { list: vi.fn().mockReturnValue(new Promise(() => {})) } });
    expect(within(card("Needs attention")).getByRole("status")).toHaveTextContent("Loading…");
  });

  it("lists each message in plain words with a Reconnect supplier button that goes to the connect screen", async () => {
    const other = aNotification({
      id: "n2",
      supplierId: "22222222-2222-4222-8222-222222222222",
      supplierName: "Globex",
      message: "Globex is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it.",
      reason: "captcha",
    });
    setup({ notifications: { list: vi.fn().mockResolvedValue([aNotification(), other]) } });
    const items = within(await within(card("Needs attention")).findByRole("list")).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Acme Supply needs you to log in again.");
    expect(
      within(items[0]!).getByRole("link", { name: "Reconnect supplier Acme Supply" }),
    ).toHaveAttribute("href", "/suppliers/11111111-1111-4111-8111-111111111111/connect");
    expect(items[1]).toHaveTextContent("Globex is asking you to solve a puzzle");
    expect(
      within(items[1]!).getByRole("link", { name: "Reconnect supplier Globex" }),
    ).toHaveAttribute("href", "/suppliers/22222222-2222-4222-8222-222222222222/connect");
  });

  it("comes before the summary cards, because it is what the owner should act on", async () => {
    setup({ notifications: { list: vi.fn().mockResolvedValue([aNotification()]) } });
    await screen.findByText("Acme Supply needs you to log in again.");
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(order[0]).toBe("Needs attention");
  });

  it("shows a plain message and Try again when the messages cannot be loaded", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError("Can't reach the server. Check your connection and try again.", 0),
      )
      .mockResolvedValue([aNotification()]);
    const { user } = setup({ notifications: { list } });
    expect(await within(card("Needs attention")).findByRole("alert")).toHaveTextContent(
      "Can't reach the server",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Acme Supply needs you to log in again.")).toBeInTheDocument();
  });
});

describe("Supplier connections", () => {
  it("says there are none, in plain words, when there are none", async () => {
    setup();
    expect(
      await within(card("Supplier connections")).findByText(/no suppliers yet/i),
    ).toBeInTheDocument();
  });

  it("counts a supplier whose pages need no login as ready, and says how many need a login", async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        aSupplier({ id: "a", name: "A", sessionStatus: "connected" }),
        aSupplier({ id: "b", name: "B", sessionStatus: "needs_reconnect" }),
        aSupplier({ id: "c", name: "C", needsLogin: false }),
        aSupplier({ id: "d", name: "D", needsLogin: false }),
      ]);
    setup({ suppliers: { list } });
    const summary = card("Supplier connections");
    expect(await within(summary).findByText("3 of 4")).toBeInTheDocument();
    expect(
      within(summary).getByText("ready to check. 1 supplier needs you to log in."),
    ).toBeInTheDocument();
  });

  it("says they are all ready, and counts two needing a login in the plural", async () => {
    const ready = vi
      .fn()
      .mockResolvedValue([
        aSupplier({ id: "a", sessionStatus: "connected" }),
        aSupplier({ id: "c", needsLogin: false }),
      ]);
    setup({ suppliers: { list: ready } });
    expect(
      await within(card("Supplier connections")).findByText("ready to check."),
    ).toBeInTheDocument();
    cleanup();
    const two = vi
      .fn()
      .mockResolvedValue([
        aSupplier({ id: "a" }),
        aSupplier({ id: "b", sessionStatus: "blocked" }),
      ]);
    setup({ suppliers: { list: two } });
    expect(
      await within(card("Supplier connections")).findByText(
        "ready to check. 2 suppliers need you to log in.",
      ),
    ).toBeInTheDocument();
  });

  describe("supplier links card", () => {
    it("says how many variants are not mapped and how many links need attention", async () => {
      setup({
        mappings: {
          unmapped: vi.fn().mockResolvedValue({ total: 340, unmapped: 212, items: [] }),
          list: vi
            .fn()
            .mockResolvedValue([
              aMapping({ id: "a", linkStatus: "never_worked" }),
              aMapping({ id: "b", linkStatus: "page_missing" }),
              aMapping({ id: "c", linkStatus: "moved" }),
              aMapping({ id: "d", linkStatus: "works" }),
              aMapping({ id: "e", linkStatus: "needs_login" }),
            ]),
        },
      });
      const c = within(
        await screen
          .findByRole("heading", { level: 2, name: "Supplier links" })
          .then((h) => h.closest("section")!),
      );
      expect(await c.findByText("212 of 340")).toBeInTheDocument();
      expect(c.getByText(/variants not mapped\. 3 links need attention\./)).toBeInTheDocument();
      expect(c.getByRole("link", { name: "See links" })).toHaveAttribute("href", "/mappings");
    });

    it("says so when Shopify has no variants yet", async () => {
      setup();
      const c = within(
        await screen
          .findByRole("heading", { level: 2, name: "Supplier links" })
          .then((h) => h.closest("section")!),
      );
      expect(await c.findByText("No variants from Shopify yet.")).toBeInTheDocument();
    });

    it("says it could not load, without breaking the rest of the page", async () => {
      setup({ mappings: { unmapped: vi.fn().mockRejectedValue(new ApiError("x", 500)) } });
      expect(await screen.findByText("Could not load links.")).toBeInTheDocument();
      expect(screen.getByText("Nothing needs your attention.")).toBeInTheDocument();
    });
  });
});

describe("links to the lists behind the numbers", () => {
  it("sends Supplier connections to the suppliers that need reconnecting when there are some, else to all suppliers", async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        aSupplier({ id: "a", sessionStatus: "connected" }),
        aSupplier({ id: "b", name: "B", sessionStatus: "needs_reconnect" }),
      ]);
    setup({ suppliers: { list } });
    const c = within(card("Supplier connections"));
    const link = await c.findByRole("link", { name: "See suppliers that need reconnecting" });
    expect(link).toHaveAttribute("href", "/suppliers?status=needs_reconnect");
    // Short on screen, so it never runs into the next box; the full words are its name.
    expect(link.textContent).toBe("See suppliers");
  });

  it("sends Supplier connections to all suppliers when none need attention", async () => {
    setup({
      suppliers: { list: vi.fn().mockResolvedValue([aSupplier({ sessionStatus: "connected" })]) },
    });
    expect(
      await within(card("Supplier connections")).findByRole("link", { name: "See suppliers" }),
    ).toHaveAttribute("href", "/suppliers");
  });

  it("shows a shimmer and says it is busy while a card loads", () => {
    setup({ suppliers: { list: vi.fn().mockReturnValue(new Promise(() => {})) } });
    expect(card("Supplier connections")).toHaveAttribute("aria-busy", "true");
  });

  it("lets the owner try again when the links cannot be loaded, without reloading the rest", async () => {
    const unmapped = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("x", 500))
      .mockResolvedValue({ total: 10, unmapped: 4, items: [] });
    const { user } = setup({ mappings: { unmapped } });
    const c = await screen
      .findByRole("heading", { level: 2, name: "Supplier links" })
      .then((h) => within(h.closest("section")!));
    await user.click(await c.findByRole("button", { name: "Try again" }));
    expect(await c.findByText("4 of 10")).toBeInTheDocument();
  });
});

describe("stock rules on the dashboard", () => {
  it("a changed-pages notification links to the stock rules, not to Reconnect", async () => {
    setup({
      notifications: {
        list: vi.fn().mockResolvedValue([
          aNotification({
            kind: "recipe_needs_review",
            reason: "page_changed",
            message: "Acme Supply's pages changed. Review its stock rules.",
          }),
        ]),
      },
    });
    expect(
      await screen.findByText("Acme Supply's pages changed. Review its stock rules."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review stock rules Acme Supply" })).toHaveAttribute(
      "href",
      "/suppliers/11111111-1111-4111-8111-111111111111/rules",
    );
    expect(screen.queryByRole("link", { name: /Reconnect supplier/ })).toBeNull();
  });

  it("an old reconnect notification still links to Reconnect", async () => {
    setup({ notifications: { list: vi.fn().mockResolvedValue([aNotification()]) } });
    expect(
      await screen.findByRole("link", { name: "Reconnect supplier Acme Supply" }),
    ).toBeInTheDocument();
  });

  it("a card counts the latest stock answers", async () => {
    const stock = (answer: "in_stock" | "out_of_stock" | "cannot_tell") => ({
      answer,
      reason: null,
      quantity: null,
      matchedText: null,
      observedAt: "2026-11-10T10:00:00.000Z",
    });
    setup({
      mappings: {
        list: vi
          .fn()
          .mockResolvedValue([
            aMapping({ id: "a", latestStock: stock("in_stock") }),
            aMapping({ id: "b", latestStock: stock("in_stock") }),
            aMapping({ id: "c", latestStock: stock("out_of_stock") }),
            aMapping({ id: "d", latestStock: stock("cannot_tell") }),
            aMapping({ id: "e" }),
          ]),
      },
    });
    const c = within(
      await screen
        .findByRole("heading", { level: 2, name: "Stock answers" })
        .then((h) => h.closest("section")!),
    );
    expect(await c.findByText("2 in stock")).toBeInTheDocument();
    expect(c.getByText("1 out of stock, 1 cannot tell.")).toBeInTheDocument();
  });

  it("says no stock check has run yet", async () => {
    setup();
    const c = within(
      await screen
        .findByRole("heading", { level: 2, name: "Stock answers" })
        .then((h) => h.closest("section")!),
    );
    expect(await c.findByText("No stock checks yet.")).toBeInTheDocument();
  });
});

describe("direction D dashboard", () => {
  const none = { total: 0, finished: 0, failed: 0, stopped: 0, streak: null };
  const harbour = aSupplier({ id: "22222222-2222-4222-8222-222222222222", name: "Harbour Goods" });
  const northline = aSupplier({
    id: "33333333-3333-4333-8333-333333333333",
    name: "Northline Wholesale",
  });
  const row = (supplierId: string, over = {}) => ({
    supplierId,
    status: { state: "waiting" as const },
    intervalMinutes: 30,
    window: null,
    nextCheckAt: new Date(Date.now() + 14 * 60_000).toISOString(),
    run: null,
    lastRun: null,
    recent: none,
    ...over,
  });

  it("says when the next check is once, in Stock checks, not again in the top bar", async () => {
    setup({ schedule: { overview: vi.fn().mockResolvedValue([row(northline.id)]) } });
    expect(await screen.findByText(/^Next check: /)).toBeInTheDocument();
    expect(screen.queryByText(/Checks on · next/)).toBeNull();
  });

  it("lists each supplier with its recent checks in words, and marks a failure streak", async () => {
    const streak = {
      total: 24,
      finished: 21,
      failed: 3,
      stopped: 0,
      streak: { count: 3, since: new Date().toISOString() },
    };
    setup({
      suppliers: { list: vi.fn().mockResolvedValue([northline, harbour]) },
      schedule: {
        overview: vi.fn().mockResolvedValue([
          row(northline.id, {
            recent: { total: 24, finished: 24, failed: 0, stopped: 0, streak: null },
          }),
          row(harbour.id, {
            recent: streak,
            status: { state: "not_checked", reason: "needs_reconnect", message: "Reconnect" },
          }),
        ]),
      },
    });
    const list = await screen.findByRole("region", { name: "Suppliers · recent checks" });
    expect(await within(list).findByText("Last 24 checks fine")).toBeInTheDocument();
    expect(within(list).getByText(/3 failed from .*, then checks stopped/)).toHaveAttribute(
      "data-tone",
      "bad",
    );
    expect(within(list).getByText("Harbour Goods")).toBeInTheDocument();
  });

  it("lists up to five waiting proposals, each with Approve, and links to all of them", async () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      aProposal({ id: `p${i}`, productTitle: `Product ${i}` }),
    );
    const { api, user } = setup({
      proposals: {
        count: vi.fn().mockResolvedValue(12),
        openPage: vi.fn().mockResolvedValue({
          items,
          total: 12,
          page: 1,
          pageSize: 5,
          writePermission: { state: "ready", message: "ok" },
        }),
      },
    });
    const waiting = await screen.findByRole("region", { name: "Waiting for approval" });
    expect(await within(waiting).findAllByRole("button", { name: /^Approve/ })).toHaveLength(5);
    expect(within(waiting).getByRole("link", { name: "All 12 proposals" })).toHaveAttribute(
      "href",
      "/proposals",
    );
    expect(api.proposals.openPage).toHaveBeenCalledWith({ page: 1, pageSize: 5 });
    await user.click(within(waiting).getByRole("button", { name: "Approve Product 0" }));
    expect(api.proposals.approve).toHaveBeenCalledWith("p0", undefined);
  });

  it("shows How it works only while no supplier has been added", async () => {
    setup({ suppliers: { list: vi.fn().mockResolvedValue([northline]) } });
    await screen.findByText("Nothing needs your attention.");
    await screen.findByRole("region", { name: "Suppliers · recent checks" });
    expect(screen.queryByRole("list", { name: "How it works" })).not.toBeInTheDocument();
  });
});
