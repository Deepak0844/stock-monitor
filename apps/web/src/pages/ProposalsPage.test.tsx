// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../api.js";
import { aProposal, fakeApi } from "../test/fake-api.js";
import { ProposalsPage } from "./ProposalsPage.js";

beforeEach(() => window.history.replaceState(null, "", "/proposals"));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ready = { state: "ready" as const, message: "Shopify allows this app to change stock." };
const setup = async (open = [aProposal()], over: { writePermission?: typeof ready | { state: "missing" | "not_connected"; message: string }; proposals?: NonNullable<Parameters<typeof fakeApi>[0]>["proposals"] } = {}) => {
  const api = fakeApi({ proposals: { open: vi.fn().mockResolvedValue({ proposals: open, writePermission: over.writePermission ?? ready }), ...over.proposals } });
  render(<ProposalsPage api={api} />);
  // Wait for the list (or the empty message) so tests start from a loaded page.
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return { api, user: userEvent.setup() };
};
const card = (name: RegExp | string) => screen.getByRole("listitem", { name });

describe("loading, empty and errors", () => {
  it("says it is loading, then says plainly there is nothing waiting", async () => {
    const api = fakeApi({ proposals: { open: vi.fn().mockReturnValue(new Promise(() => {})) } });
    render(<ProposalsPage api={api} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    cleanup();
    await setup([]);
    expect(await screen.findByText(/Nothing is waiting for you/)).toBeInTheDocument();
  });

  it("shows a plain error and tries again", async () => {
    const open = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0)).mockResolvedValue({ proposals: [aProposal()], writePermission: ready });
    const { user } = await setup([], { proposals: { open } });
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

  it("Reject needs no reason and removes it from the waiting list", async () => {
    const reject = vi.fn().mockResolvedValue(aProposal({ state: "rejected" }));
    const { user } = await setup([aProposal()], { proposals: { reject } });
    await user.click(within(card(/Blue Tee/)).getByRole("button", { name: /Reject/ }));
    expect(reject).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: /Blue Tee/ })).toBeNull());
    expect(screen.getByText(/Nothing is waiting for you/)).toBeInTheDocument();
  });

  it("every button names its product, so a screen reader knows which one", async () => {
    await setup([aProposal(), aProposal({ id: "2", productTitle: "Red Cap" })]);
    expect(screen.getByRole("button", { name: "Approve Red Cap, Large" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject Blue Tee, Large" })).toBeInTheDocument();
  });
});

describe("waiting for Shopify", () => {
  it("checks again every few seconds while one is waiting, and shows when it is applied", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const open = vi
      .fn()
      .mockResolvedValueOnce({ proposals: [aProposal({ state: "approved", approvedQuantity: 0 })], writePermission: ready })
      .mockResolvedValue({ proposals: [], writePermission: ready });
    await setup([], { proposals: { open } });
    expect(await screen.findByText(/Waiting for Shopify/)).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(5500)));
    expect(open).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Nothing is waiting for you/)).toBeInTheDocument();
  });
});

describe("history", () => {
  const history = (rows: ReturnType<typeof aProposal>[], hasMore = false) => vi.fn().mockResolvedValue({ proposals: rows, hasMore, page: 1 });

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
    const table = await screen.findByRole("table", { name: "Past suggestions" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Product", "Supplier", "Shopify showed", "Suggested", "Result"]);
    expect(within(within(table).getByRole("row", { name: /Blue Tee/ })).getByText("Applied")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Red Cap/ })).getByText("Shopify now shows 3, so nothing was changed.")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Green Hat/ })).getByText(/permission/)).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Grey Sock/ })).getByText("The latest check could not tell.")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Pink Scarf/ })).getByText("Expired")).toBeInTheDocument();
  });

  it("says plainly when there is no history, and pages when there is more", async () => {
    const hist = vi.fn().mockResolvedValueOnce({ proposals: [aProposal({ state: "rejected" })], hasMore: true, page: 1 }).mockResolvedValueOnce({ proposals: [aProposal({ id: "z", state: "rejected", productTitle: "Older Tee" })], hasMore: false, page: 2 });
    const { user } = await setup([], { proposals: { history: hist } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: "Older" }));
    expect(hist).toHaveBeenLastCalledWith(2);
    expect(await screen.findByText("Older Tee")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Older" })).toBeNull();
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
    const { user } = await setup([], { proposals: { history: vi.fn().mockResolvedValue({ proposals: rows, hasMore: false, page: 1 }) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    const table = await screen.findByRole("table", { name: "Past suggestions" });
    for (const name of ["Red Cap", "Green Hat", "Pink Scarf"]) {
      expect(within(within(table).getByRole("row", { name: new RegExp(name) })).getByRole("button", { name: `Refresh ${name}, Large` })).toBeInTheDocument();
    }
    expect(within(within(table).getByRole("row", { name: /Blue Tee/ })).queryByRole("button", { name: /Refresh/ })).toBeNull();
    expect(within(within(table).getByRole("row", { name: /Grey Sock/ })).queryByRole("button", { name: /Refresh/ })).toBeNull();
  });

  it("asks for a refresh and says where the new suggestion will appear", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { user } = await setup([], { proposals: { refresh, history: vi.fn().mockResolvedValue({ proposals: rows, hasMore: false, page: 1 }) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: "Refresh Red Cap, Large" }));
    expect(refresh).toHaveBeenCalledWith("c");
        expect(await screen.findByText(/Reading Shopify again/)).toBeInTheDocument();
  });

  it("shows the plain reason when a refresh cannot start", async () => {
    const refresh = vi.fn().mockRejectedValue(new ApiError("Could not start that. Try again in a minute.", 503));
    const { user } = await setup([], { proposals: { refresh, history: vi.fn().mockResolvedValue({ proposals: rows, hasMore: false, page: 1 }) } });
    await user.click(await screen.findByRole("button", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: "Refresh Green Hat, Large" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start that.");
  });
});
