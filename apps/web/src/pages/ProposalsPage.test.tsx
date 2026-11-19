// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../api.js";
import { aProposal, aSupplier, fakeApi } from "../test/fake-api.js";
import { ProposalsPage } from "./ProposalsPage.js";

beforeEach(() => window.history.replaceState(null, "", "/proposals"));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ready = { state: "ready" as const, message: "Shopify allows this app to change stock." };
const setup = async (open = [aProposal()], over: { writePermission?: typeof ready | { state: "missing" | "not_connected"; message: string }; proposals?: NonNullable<Parameters<typeof fakeApi>[0]>["proposals"] } = {}) => {
  const api = fakeApi({ proposals: { openPage: vi.fn().mockResolvedValue({ items: open, total: open.length, page: 1, pageSize: 10, writePermission: over.writePermission ?? ready }), ...over.proposals } });
  render(<ProposalsPage api={api} />);
  // Wait for the list (or the empty message) so tests start from a loaded page.
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return { api, user: userEvent.setup() };
};
const card = (name: RegExp | string) => screen.getByRole("listitem", { name });
/** The supplier filter is a dropdown with search: open it and pick by name ("" picks All suppliers). */
const pickSupplier = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole("button", { name: /^Supplier:/ }));
  await user.click(await screen.findByRole("option", { name: name ? new RegExp(name) : /All suppliers/ }));
};

describe("loading, empty and errors", () => {
  it("says it is loading, then says plainly there is nothing waiting", async () => {
    const api = fakeApi({ proposals: { openPage: vi.fn().mockReturnValue(new Promise(() => {})) } });
    render(<ProposalsPage api={api} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    cleanup();
    await setup([]);
    expect(await screen.findByText(/Nothing is waiting for you/)).toBeInTheDocument();
  });

  it("shows a plain error and tries again", async () => {
    const openPage = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0)).mockResolvedValue({ items: [aProposal()], total: 1, page: 1, pageSize: 10, writePermission: ready });
    const { user } = await setup([], { proposals: { openPage } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Blue Tee")).toBeInTheDocument();
  });
});

describe("a suggestion", () => {
  it("shows the product, what the supplier said, what Shopify shows and the suggested number", async () => {
    await setup();
    const item = card(/Blue Tee/);
    expect(within(item).getByRole("heading", { name: /Blue Tee/ })).toHaveTextContent("Large");
    expect(within(item).getByText("SKU S-1")).toBeInTheDocument();
    expect(within(item).getByText("Out of stock")).toBeInTheDocument(); // the kind
    expect(within(item).getByText(/Acme Supply said Out of stock/)).toBeInTheDocument();
    expect(within(item).getByText(/Shopify shows 4/)).toBeInTheDocument();
    expect(within(item).getByText(/Suggested: set to 0/)).toBeInTheDocument();
    expect(within(item).getByText(/Waiting for you/)).toBeInTheDocument();
    expect(within(item).getByText(/Expires/)).toBeInTheDocument();
  });

  it("shows a restock suggestion with the default quantity", async () => {
    await setup([aProposal({ kind: "restock", proposedQuantity: 5, shopifyQuantitySeen: 0, observed: { answer: "in_stock", reason: null, at: "2026-11-09T08:00:00.000Z" } })]);
    const item = card(/Blue Tee/);
    expect(within(item).getByText("Back in stock")).toBeInTheDocument();
    expect(within(item).getByText(/Suggested: set to 5/)).toBeInTheDocument();
  });

  it("warns, in words, when Shopify is set to keep selling", async () => {
    await setup([aProposal({ continueSelling: true })]);
    expect(within(card(/Blue Tee/)).getByText(/keep selling when stock is 0/i)).toBeInTheDocument();
  });

  it("turns Approve off with the reason when Shopify is not tracking the item", async () => {
    await setup([aProposal({ tracked: false, blockedReason: "Shopify is not tracking stock for this item, so changing the quantity would have no effect." })]);
    const item = card(/Blue Tee/);
    expect(within(item).getByText(/not tracking stock/)).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: /Approve/ })).toBeDisabled();
  });

  it("turns Approve off and explains it when Shopify has not given write permission", async () => {
    await setup([aProposal()], { writePermission: { state: "missing", message: "Shopify has not given this app permission to change stock yet." } });
    expect(screen.getByText("Shopify has not given this app permission to change stock yet.")).toBeInTheDocument();
    expect(within(card(/Blue Tee/)).getByRole("button", { name: /Approve/ })).toBeDisabled();
  });
});

describe("approving, editing and rejecting", () => {
  it("one press on Approve approves that suggestion and shows Waiting for Shopify", async () => {
    const approve = vi.fn().mockResolvedValue(aProposal({ state: "approved", approvedQuantity: 0 }));
    const { user } = await setup([aProposal(), aProposal({ id: "2", productTitle: "Red Cap" })], { proposals: { approve } });
    await user.click(within(card(/Blue Tee/)).getByRole("button", { name: /Approve/ }));
    expect(approve).toHaveBeenCalledWith("p1", undefined);
    expect(await within(card(/Blue Tee/)).findByText(/Waiting for Shopify/)).toBeInTheDocument();
    expect(within(card(/Blue Tee/)).queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(within(card(/Red Cap/)).getByRole("button", { name: /Approve/ })).toBeEnabled(); // others untouched
  });

  it("Edit number lets the owner type another whole number, and Approve sends it", async () => {
    const approve = vi.fn().mockResolvedValue(aProposal({ state: "approved", approvedQuantity: 3, edited: true }));
    const { user } = await setup([aProposal({ kind: "restock", proposedQuantity: 5, shopifyQuantitySeen: 0 })], { proposals: { approve } });
    const item = card(/Blue Tee/);
    await user.click(within(item).getByRole("button", { name: /Edit number/ }));
    const input = within(item).getByLabelText("New number");
    expect(input).toHaveValue("5");
    await user.clear(input);
    await user.type(input, "3");
    await user.click(within(item).getByRole("button", { name: /Approve/ }));
    expect(approve).toHaveBeenCalledWith("p1", 3);
  });

  it("refuses a number that is not a whole number from 0 up, next to the field, without calling the server", async () => {
    const approve = vi.fn();
    const { user } = await setup([aProposal()], { proposals: { approve } });
    const item = card(/Blue Tee/);
    await user.click(within(item).getByRole("button", { name: /Edit number/ }));
    const input = within(item).getByLabelText("New number");
    await user.clear(input);
    await user.type(input, "-2");
    await user.click(within(item).getByRole("button", { name: /Approve/ }));
    expect(within(item).getByRole("alert")).toHaveTextContent("Enter a whole number from 0 up.");
    await user.clear(input);
    await user.type(input, "1.5");
    await user.click(within(item).getByRole("button", { name: /Approve/ }));
    expect(within(item).getByRole("alert")).toHaveTextContent("Enter a whole number from 0 up.");
    expect(approve).not.toHaveBeenCalled();
  });

  it("shows the server's plain refusal on the suggestion and keeps it open", async () => {
    const approve = vi.fn().mockRejectedValue(new ApiError("This suggestion expired. The next check will make a new one if it still applies.", 409));
    const { user } = await setup([aProposal()], { proposals: { approve } });
    const item = card(/Blue Tee/);
    await user.click(within(item).getByRole("button", { name: /Approve/ }));
    expect(await within(item).findByRole("alert")).toHaveTextContent("This suggestion expired");
    expect(within(item).getByRole("button", { name: /Approve/ })).toBeEnabled();
  });

  it("does not send twice when Approve is pressed twice quickly", async () => {
    let finish: (p: ReturnType<typeof aProposal>) => void = () => {};
    const approve = vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user } = await setup([aProposal()], { proposals: { approve } });
    const button = within(card(/Blue Tee/)).getByRole("button", { name: /Approve/ });
    await user.click(button);
    await user.click(button);
    expect(approve).toHaveBeenCalledTimes(1);
    await act(async () => finish(aProposal({ state: "approved", approvedQuantity: 0 })));
  });

  it("Reject needs no reason, removes it at once, and is sent after the five seconds for Undo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reject = vi.fn().mockResolvedValue(aProposal({ state: "rejected" }));
    // Like the real server: once rejected, it is no longer in the waiting list.
    const openPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [aProposal()], total: 1, page: 1, pageSize: 10, writePermission: ready })
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10, writePermission: ready });
    const { user } = await setup([aProposal()], { proposals: { reject, openPage } });
    await user.click(within(card(/Blue Tee/)).getByRole("button", { name: /Reject/ }));
    expect(screen.queryByRole("listitem", { name: /Blue Tee/ })).toBeNull();
    expect(reject).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(reject).toHaveBeenCalledWith("p1", { keepalive: false });
    await waitFor(() => expect(screen.queryByRole("listitem", { name: /Blue Tee/ })).toBeNull());
    expect(screen.getByText(/Nothing is waiting for you/)).toBeInTheDocument();
  });

  it("every button names its product, so a screen reader knows which one", async () => {
    await setup([aProposal(), aProposal({ id: "2", productTitle: "Red Cap" })]);
    expect(screen.getByRole("button", { name: "Approve Red Cap, Large" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject Blue Tee, Large" })).toBeInTheDocument();
  });
});

describe("paging the waiting list", () => {
  it("asks the server for ten at a time and moves between pages", async () => {
    const reply = (items: ReturnType<typeof aProposal>[], page: number) => ({ items, total: 12, page, pageSize: 10, writePermission: ready });
    const openPage = vi.fn().mockResolvedValueOnce(reply([aProposal()], 1)).mockResolvedValue(reply([aProposal({ id: "2", productTitle: "Red Cap" })], 2));
    const { user } = await setup([], { proposals: { openPage } });
    expect(await screen.findByText("Showing 1–10 of 12")).toBeInTheDocument();
    expect(openPage).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Red Cap")).toBeInTheDocument();
    expect(openPage).toHaveBeenLastCalledWith({ page: 2, pageSize: 10 });
    expect(window.location.search).toBe("?page=2");
  });

  it("shows a spinner on Approve while it is sent, and none on the other buttons", async () => {
    const approve = vi.fn(() => new Promise<never>(() => {}));
    const { user } = await setup([aProposal()], { proposals: { approve } });
    const item = within(card(/Blue Tee/));
    await user.click(item.getByRole("button", { name: /Approve/ }));
    expect(item.getByRole("button", { name: /Approve/ })).toHaveAttribute("aria-busy", "true");
    expect(item.getByRole("button", { name: /Reject/ })).not.toHaveAttribute("aria-busy");
  });

  it("opens on the History tab when the address says so", async () => {
    window.history.replaceState(null, "", "/proposals?tab=history");
    const hist = vi.fn().mockResolvedValue({ proposals: [aProposal({ state: "rejected" })], hasMore: false, total: 1, page: 1, pageSize: 10 });
    await setup([], { proposals: { history: hist } });
    expect(await screen.findByRole("table", { name: "Past suggestions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("minor fixes", () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("does not say nothing is waiting while it reads the next page after the last one on the page is decided", async () => {
    const reply = (items: ReturnType<typeof aProposal>[]) => ({ items, total: 11, page: 1, pageSize: 10, writePermission: ready });
    const second = deferred<ReturnType<typeof reply>>();
    let decided = false;
    const openPage = vi.fn(() => (decided ? second.promise : Promise.resolve(reply([aProposal()]))));
    const reject = vi.fn(async () => {
      decided = true;
      return aProposal({ state: "rejected" });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = await setup([], { proposals: { openPage, reject } });
    await user.click(await screen.findByRole("button", { name: /Reject/ }));
    await act(async () => void vi.advanceTimersByTime(5000));
    await waitFor(() => expect(reject).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("listitem")).toBeNull());
    expect(screen.queryByText(/Nothing is waiting for you/)).toBeNull();
    await act(async () => second.resolve(reply([aProposal({ id: "z", productTitle: "Red Cap" })])));
    expect(await screen.findByText("Red Cap")).toBeInTheDocument();
  });

  it("keeps the newest history page on screen when an older, slower request answers last", async () => {
    window.history.replaceState(null, "", "/proposals?tab=history");
    const reply = (title: string, page: number) => ({ proposals: [aProposal({ id: title, state: "rejected", productTitle: title })], hasMore: true, total: 30, page, pageSize: 10 });
    const two = deferred<ReturnType<typeof reply>>();
    const three = deferred<ReturnType<typeof reply>>();
    const history = vi.fn().mockResolvedValueOnce(reply("One Tee", 1)).mockReturnValueOnce(two.promise).mockReturnValueOnce(three.promise);
    const { user } = await setup([], { proposals: { history } });
    await screen.findByText("One Tee");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await act(async () => three.resolve(reply("Three Tee", 3)));
    await act(async () => two.resolve(reply("Two Tee", 2)));
    expect(await screen.findByText("Three Tee")).toBeInTheDocument();
    expect(screen.queryByText("Two Tee")).toBeNull();
  });

  it("sends one refresh when Refresh is pressed twice, and shows it busy meanwhile", async () => {
    const pending = deferred<undefined>();
    const refresh = vi.fn().mockReturnValue(pending.promise);
    const row = aProposal({ id: "c", state: "conflict", resultCode: "changed", resultQuantity: 3, productTitle: "Red Cap" });
    const { user } = await setup([], { proposals: { refresh, history: vi.fn().mockResolvedValue({ proposals: [row], hasMore: false, total: 1, page: 1, pageSize: 10 }) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    const button = await screen.findByRole("button", { name: "Refresh Red Cap, Large" });
    await user.click(button);
    await user.click(button);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => pending.resolve(undefined));
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
  });
});

describe("waiting for Shopify", () => {
  it("checks again every few seconds while one is waiting, and shows when it is applied", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reply = (items: ReturnType<typeof aProposal>[]) => ({ items, total: items.length, page: 1, pageSize: 10, writePermission: ready });
    const openPage = vi.fn().mockResolvedValueOnce(reply([aProposal({ state: "approved", approvedQuantity: 0 })])).mockResolvedValue(reply([]));
    await setup([], { proposals: { openPage } });
    expect(await screen.findByText(/Waiting for Shopify/)).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(5500)));
    expect(openPage).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Nothing is waiting for you/)).toBeInTheDocument();
  });
});

describe("history", () => {
  const history = (rows: ReturnType<typeof aProposal>[], hasMore = false) => vi.fn().mockResolvedValue({ proposals: rows, hasMore, total: rows.length, page: 1, pageSize: 10 });

  it("lists decided suggestions with their result in plain words", async () => {
    const rows = [
      aProposal({ id: "a", state: "applied", approvedQuantity: 0, resultCode: "applied", resultQuantity: 0 }),
      aProposal({ id: "b", state: "conflict", resultCode: "changed", resultQuantity: 3, productTitle: "Red Cap" }),
      aProposal({ id: "c", state: "failed", resultCode: "no_permission", productTitle: "Green Hat" }),
      aProposal({ id: "d", state: "replaced", closedReason: "could_not_tell", productTitle: "Grey Sock" }),
      aProposal({ id: "e", state: "expired", productTitle: "Pink Scarf" }),
    ];
    const { user } = await setup([], { proposals: { history: history(rows) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    // The table shows while loading too, with placeholder rows: wait for a real row first.
    await screen.findByRole("row", { name: /Blue Tee/ });
    const table = screen.getByRole("table", { name: "Past suggestions" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Product", "Supplier", "Shopify showed", "Suggested", "Result"]);
    expect(within(within(table).getByRole("row", { name: /Blue Tee/ })).getByText("Applied")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Red Cap/ })).getByText("Shopify now shows 3, so nothing was changed.")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Green Hat/ })).getByText(/permission/)).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Grey Sock/ })).getByText("The latest check could not tell.")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Pink Scarf/ })).getByText("Expired")).toBeInTheDocument();
  });

  it("says plainly when there is no history, and pages when there is more", async () => {
    const hist = vi
      .fn()
      .mockResolvedValueOnce({ proposals: [aProposal({ state: "rejected" })], hasMore: true, total: 11, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ proposals: [aProposal({ id: "z", state: "rejected", productTitle: "Older Tee" })], hasMore: false, total: 11, page: 2, pageSize: 10 });
    const { user } = await setup([], { proposals: { history: hist } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    expect(await screen.findByText("Showing 1–10 of 11")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    expect(hist).toHaveBeenLastCalledWith(2, 10);
    expect(await screen.findByText("Older Tee")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(window.location.search).toBe("?tab=history&page=2");
  });

  it("an empty history says so", async () => {
    const { user } = await setup([], { proposals: { history: history([]) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    expect(await screen.findByText("No past suggestions yet.")).toBeInTheDocument();
  });
});

describe("refresh", () => {
  const rows = [
    aProposal({ id: "c", state: "conflict", resultCode: "changed", resultQuantity: 3, productTitle: "Red Cap" }),
    aProposal({ id: "f", state: "failed", resultCode: "refused", productTitle: "Green Hat" }),
    aProposal({ id: "e", state: "expired", productTitle: "Pink Scarf" }),
    aProposal({ id: "a", state: "applied", approvedQuantity: 0, resultCode: "applied", resultQuantity: 0 }),
    aProposal({ id: "r", state: "rejected", productTitle: "Grey Sock" }),
  ];

  it("offers Refresh on a suggestion that was not applied or expired, and on no other", async () => {
    const { user } = await setup([], { proposals: { history: vi.fn().mockResolvedValue({ proposals: rows, hasMore: false, total: rows.length, page: 1, pageSize: 10 }) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    // The table shows while loading too, with placeholder rows: wait for a real row first.
    await screen.findByRole("row", { name: /Blue Tee/ });
    const table = screen.getByRole("table", { name: "Past suggestions" });
    for (const name of ["Red Cap", "Green Hat", "Pink Scarf"]) {
      expect(within(within(table).getByRole("row", { name: new RegExp(name) })).getByRole("button", { name: `Refresh ${name}, Large` })).toBeInTheDocument();
    }
    expect(within(within(table).getByRole("row", { name: /Blue Tee/ })).queryByRole("button", { name: /Refresh/ })).toBeNull();
    expect(within(within(table).getByRole("row", { name: /Grey Sock/ })).queryByRole("button", { name: /Refresh/ })).toBeNull();
  });

  it("asks for a refresh and says where the new suggestion will appear", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { user } = await setup([], { proposals: { refresh, history: vi.fn().mockResolvedValue({ proposals: rows, hasMore: false, total: rows.length, page: 1, pageSize: 10 }) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: "Refresh Red Cap, Large" }));
    expect(refresh).toHaveBeenCalledWith("c");
        expect(await screen.findByText(/Reading Shopify again/)).toBeInTheDocument();
  });

  it("shows the plain reason when a refresh cannot start", async () => {
    const refresh = vi.fn().mockRejectedValue(new ApiError("Could not start that. Try again in a minute.", 503));
    const { user } = await setup([], { proposals: { refresh, history: vi.fn().mockResolvedValue({ proposals: rows, hasMore: false, total: rows.length, page: 1, pageSize: 10 }) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: "Refresh Green Hat, Large" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start that.");
  });
});

describe("by supplier", () => {
  const acme = aSupplier({ id: "s1", name: "Acme" });
  const bolt = aSupplier({ id: "s2", name: "Bolt" });
  const withSuppliers = (over: Parameters<typeof fakeApi>[0] = {}) =>
    fakeApi({ ...over, suppliers: { list: vi.fn().mockResolvedValue([acme, bolt]), ...over.suppliers }, proposals: { waitingBySupplier: vi.fn().mockResolvedValue({ s1: 2 }), ...over.proposals } });
  /** Opens the supplier dropdown, reads its choices as "Name (count)", and closes it again. */
  const options = async () => {
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: /^Supplier:/ }));
    const texts = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => {
      const name = o.firstElementChild?.textContent ?? "";
      const count = o.lastElementChild?.textContent ?? "";
      return count ? `${name} (${count})` : name;
    });
    await u.keyboard("{Escape}");
    return texts;
  };

  it("filters waiting suggestions by the chosen supplier, with counts", async () => {
    const api = withSuppliers();
    render(<ProposalsPage api={api} />);
    await waitFor(async () => expect(await options()).toEqual(["All suppliers", "Acme (2)", "Bolt (0)"]));
    await pickSupplier(userEvent.setup(), "Bolt");
    await waitFor(() => expect(api.proposals.openPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, supplierId: "s2" }));
    expect(await screen.findByText("Nothing is waiting for Bolt.")).toBeInTheDocument();
  });

  it("goes back to page 1 when the supplier changes", async () => {
    window.history.replaceState(null, "", "/proposals?page=3");
    const api = withSuppliers();
    render(<ProposalsPage api={api} />);
    await waitFor(async () => expect(await options()).toHaveLength(3));
    expect(api.proposals.openPage).toHaveBeenCalledWith({ page: 3, pageSize: 10 });
    await pickSupplier(userEvent.setup(), "Acme");
    await waitFor(() => expect(api.proposals.openPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, supplierId: "s1" }));
  });

  it("keeps the supplier when switching to History, with names only", async () => {
    const api = withSuppliers();
    render(<ProposalsPage api={api} />);
    const user = userEvent.setup();
    await waitFor(async () => expect(await options()).toHaveLength(3));
    await pickSupplier(user, "Acme");
    await user.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(api.proposals.history).toHaveBeenLastCalledWith(1, 10, "s1"));
    expect(await options()).toEqual(["All suppliers", "Acme", "Bolt"]);
    expect(await screen.findByText("No past suggestions for Acme yet.")).toBeInTheDocument();
  });

  it("shows everything when the address names a supplier that is not in the list", async () => {
    window.history.replaceState(null, "", "/proposals?supplier=99999999-9999-4999-8999-999999999999");
    const api = withSuppliers();
    render(<ProposalsPage api={api} />);
    await waitFor(async () => expect(await options()).toHaveLength(3));
    await waitFor(() => expect(api.proposals.openPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }));
    expect(screen.getByRole("button", { name: /^Supplier:/ })).toHaveTextContent("All suppliers");
  });

  it("shows the supplier last chosen even when an earlier answer comes back later", async () => {
    const replies: Record<string, (v: unknown) => void> = {};
    const openPage = vi.fn().mockImplementation(({ supplierId }: { supplierId?: string }) =>
      supplierId ? new Promise((resolve) => (replies[supplierId] = resolve)) : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 10, writePermission: ready }),
    );
    const api = withSuppliers({ proposals: { openPage } });
    render(<ProposalsPage api={api} />);
    const user = userEvent.setup();
    await waitFor(async () => expect(await options()).toHaveLength(3));
    await pickSupplier(user, "Acme");
    await pickSupplier(user, "Bolt");
    await act(async () => replies.s2!({ items: [aProposal({ id: "b", productTitle: "Red Cap" })], total: 1, page: 1, pageSize: 10, writePermission: ready }));
    await act(async () => replies.s1!({ items: [aProposal({ id: "a", productTitle: "Blue Tee" })], total: 1, page: 1, pageSize: 10, writePermission: ready }));
    expect(screen.getByText("Red Cap")).toBeInTheDocument();
    expect(screen.queryByText("Blue Tee")).toBeNull();
  });

  it("reads the counts again after a suggestion is decided", async () => {
    const waitingBySupplier = vi.fn().mockResolvedValueOnce({ s1: 2 }).mockResolvedValue({ s1: 1 });
    const api = withSuppliers({ proposals: { waitingBySupplier, openPage: vi.fn().mockResolvedValue({ items: [aProposal()], total: 1, page: 1, pageSize: 10, writePermission: ready }) } });
    render(<ProposalsPage api={api} />);
    const user = userEvent.setup();
    await waitFor(async () => expect(await options()).toContain("Acme (2)"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.click(screen.getByRole("button", { name: "Reject Blue Tee, Large" }));
    await act(async () => void vi.advanceTimersByTime(5000));
    await waitFor(async () => expect(await options()).toContain("Acme (1)"));
  });

  it("still lists everything when suppliers cannot be read", async () => {
    const api = withSuppliers({ suppliers: { list: vi.fn().mockRejectedValue(new Error("down")) }, proposals: { openPage: vi.fn().mockResolvedValue({ items: [aProposal()], total: 1, page: 1, pageSize: 10, writePermission: ready }) } });
    render(<ProposalsPage api={api} />);
    expect(await screen.findByText("Blue Tee")).toBeInTheDocument();
    expect(await options()).toEqual(["All suppliers"]);
  });
});

describe("bulk approve and reject", () => {
  const three = [
    aProposal({ id: "a", productTitle: "Blue Tee" }),
    aProposal({ id: "b", productTitle: "Red Cap" }),
    aProposal({ id: "c", productTitle: "Green Sock" }),
  ];

  it("shows a bar with Approve and Reject for the ticked rows, and ticks the whole page from one box", async () => {
    const { user } = await setup(three);
    await user.click(screen.getByRole("checkbox", { name: "Select Blue Tee, Large" }));
    expect(screen.getByRole("region", { name: "Selected proposals" })).toHaveTextContent("1 selected");
    await user.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(screen.getByRole("button", { name: "Approve 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject 3" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Selected proposals" })).toBeNull();
  });

  it("asks once, then approves each with the number its row shows", async () => {
    const { api, user } = await setup(three);
    await user.click(within(card(/Red Cap/)).getByRole("button", { name: /Edit number/ }));
    const box = within(card(/Red Cap/)).getByLabelText("New number");
    await user.clear(box);
    await user.type(box, "5");
    await user.click(screen.getByRole("checkbox", { name: "Select Blue Tee, Large" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Red Cap, Large" }));
    await user.click(screen.getByRole("button", { name: "Approve 2" }));
    const dialog = screen.getByRole("dialog", { name: "Approve 2 changes?" });
    expect(dialog).toHaveTextContent("Shopify will be updated for each.");
    expect(api.proposals.approve).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Approve 2" }));
    await waitFor(() => expect(api.proposals.approve).toHaveBeenCalledTimes(2));
    expect(api.proposals.approve).toHaveBeenNthCalledWith(1, "a", undefined);
    expect(api.proposals.approve).toHaveBeenNthCalledWith(2, "b", 5);
  });

  it("approves the rest when one was already decided, and names the one that failed with the reason", async () => {
    const approve = vi.fn().mockImplementation(async (id: string) => {
      if (id === "b") throw new ApiError("This suggestion can no longer be decided.", 409);
      return aProposal({ id, state: "approved", approvedQuantity: 0 });
    });
    const { user } = await setup(three, { proposals: { approve } });
    await user.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    await user.click(screen.getByRole("button", { name: "Approve 3" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve 3" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole("alert")).toHaveTextContent("Red Cap: This suggestion can no longer be decided.");
  });

  it("Reject N hides them at once, offers Undo, and sends each after five seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, user } = await setup(three);
    await user.click(screen.getByRole("checkbox", { name: "Select Blue Tee, Large" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Green Sock, Large" }));
    await user.click(screen.getByRole("button", { name: "Reject 2" }));
    expect(screen.queryByRole("listitem", { name: /Blue Tee/ })).toBeNull();
    expect(screen.getByRole("listitem", { name: /Red Cap/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 proposals rejected.");
    await act(async () => void vi.advanceTimersByTime(5000));
    await waitFor(() => expect(api.proposals.reject).toHaveBeenCalledTimes(2));
    expect(api.proposals.reject).toHaveBeenCalledWith("a", { keepalive: false });
  });

  it("sorts the waiting list through the address", async () => {
    const { api, user } = await setup(three);
    await user.selectOptions(screen.getByLabelText("Sort"), "supplier");
    await waitFor(() => expect(api.proposals.openPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, sort: "supplier", dir: "asc" }));
  });
  it("sends every waiting reject at once when the owner leaves the page, not just the first", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, user } = await setup(three);
    await user.click(screen.getByRole("checkbox", { name: "Select Blue Tee, Large" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Red Cap, Large" }));
    await user.click(screen.getByRole("button", { name: "Reject 2" }));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(api.proposals.reject).toHaveBeenCalledTimes(2);
    expect(api.proposals.reject).toHaveBeenCalledWith("b", { keepalive: true });
  });
});
