// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError, type Mapping } from "../api.js";
import { aMapping, aSupplier, fakeApi } from "../test/fake-api.js";
import { MappingsPage } from "./MappingsPage.js";

beforeEach(() => window.history.replaceState(null, "", "/mappings"));
afterEach(cleanup);

const acme = aSupplier();
const blue = aMapping();
const red = aMapping({ id: "55555555-5555-4555-8555-555555555555", variantId: "v2", productTitle: "Red Tee", variantTitle: "Small", sku: "B0362", linkStatus: "works" });

const setup = (mappings: Mapping[], over: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi({
    ...over,
    suppliers: { list: vi.fn().mockResolvedValue([acme]), ...over.suppliers },
    mappings: { list: vi.fn().mockResolvedValue(mappings), ...over.mappings },
  });
  render(<MappingsPage api={api} />);
  return { api, user: userEvent.setup() };
};

describe("empty and loading", () => {
  it("shows a loading message first", () => {
    const api = fakeApi({ mappings: { list: vi.fn().mockReturnValue(new Promise(() => {})) } });
    render(<MappingsPage api={api} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("says plainly there are no links and offers to add one or import", async () => {
    setup([]);
    expect(await screen.findByText(/No links yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add link" })[0]).toHaveAttribute("href", "/mappings/new");
    expect(screen.getAllByRole("link", { name: "Import from Shopify export" })[0]).toHaveAttribute("href", "/mappings/import");
  });

  it("shows a plain error and tries again", async () => {
    const list = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0)).mockResolvedValue([blue]);
    const { user } = setup([], { mappings: { list } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Blue Tee")).toBeInTheDocument();
  });
});

describe("the table", () => {
  it("shows product, variant, SKU, supplier, the page's host and path, the status in words and when it was checked", async () => {
    setup([blue, { ...red, lastLinkCheckAt: "2026-11-09T10:00:00.000Z" }]);
    const row = within(await screen.findByRole("row", { name: /Blue Tee/ }));
    expect(row.getByText("Large · B0361")).toBeInTheDocument();
    expect(row.getByText("Acme Supply")).toBeInTheDocument();
    expect(row.getByText("shop.acme.example/p/blue")).toBeInTheDocument();
    expect(row.getByText("Not checked")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Red Tee/ })).getByText("Works")).toBeInTheDocument();
  });

  it("says when the page went missing, since when it worked, and when it may be unavailable", async () => {
    setup([aMapping({ linkStatus: "page_missing", lastWorkedAt: "2026-11-05T10:00:00.000Z", unavailableCandidate: true })]);
    const row = within(await screen.findByRole("row", { name: /Blue Tee/ }));
    expect(row.getByText("Page missing")).toBeInTheDocument();
    expect(row.getByText(/Worked until/)).toBeInTheDocument();
    expect(row.getByText("May be unavailable")).toBeInTheDocument();
  });

  it.each([
    ["never_worked", "Never worked", /never loaded the right page/],
    ["moved", "Moved", /sends this address somewhere else/],
    ["looks_different", "Looks different", /changed/],
    ["needs_login", "Needs login", /supplier/],
    ["could_not_check", "Could not check", /Nothing was concluded/],
  ] as const)("explains %s in plain words", async (linkStatus, words, hint) => {
    setup([aMapping({ linkStatus })]);
    const row = within(await screen.findByRole("row", { name: /Blue Tee/ }));
    expect(row.getByText(words)).toBeInTheDocument();
    expect(row.getByText(hint)).toBeInTheDocument();
  });

  it("labels a link whose variant Shopify removed", async () => {
    setup([aMapping({ variantRemoved: true })]);
    expect(await screen.findByText("Variant removed in Shopify")).toBeInTheDocument();
  });
});

describe("filters", () => {
  it("asks the server for one supplier, one status and a search", async () => {
    const { api, user } = setup([blue]);
    await screen.findByText("Blue Tee");
    await user.selectOptions(screen.getByLabelText("Supplier"), acme.id);
    await user.selectOptions(screen.getByLabelText("Link status"), "works");
    await user.type(screen.getByLabelText("Search links"), "blue");
    await waitFor(() => expect(api.mappings.list).toHaveBeenLastCalledWith({ supplierId: acme.id, status: "works", search: "blue" }));
  });
});

describe("checking links", () => {
  it("checks one link and says it started", async () => {
    const { api, user } = setup([blue]);
    await user.click(await screen.findByRole("button", { name: "Check now Blue Tee Large" }));
    expect(api.mappings.checkLink).toHaveBeenCalledWith(blue.id);
    expect(await screen.findByText(/has started/i)).toBeInTheDocument();
  });

  it("shows the server's plain reason when a check is refused", async () => {
    const checkLink = vi.fn().mockRejectedValue(new ApiError("You have not recorded permission to check this supplier automatically. Open the supplier to record it.", 409, "no_permission"));
    const { user } = setup([blue], { mappings: { checkLink } });
    await user.click(await screen.findByRole("button", { name: "Check now Blue Tee Large" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("recorded permission");
  });

  it("checks all of one supplier's links once that supplier is chosen", async () => {
    const checkSupplierLinks = vi.fn().mockResolvedValue(3);
    const { user } = setup([blue], { mappings: { checkSupplierLinks } });
    await screen.findByText("Blue Tee");
    expect(screen.queryByRole("button", { name: /Check all links/ })).toBeNull();
    await user.selectOptions(screen.getByLabelText("Supplier"), acme.id);
    await user.click(await screen.findByRole("button", { name: "Check all links for Acme Supply" }));
    expect(checkSupplierLinks).toHaveBeenCalledWith(acme.id);
    expect(await screen.findByText(/3 links/)).toBeInTheDocument();
  });
});

describe("deleting", () => {
  it("asks first, then removes the row", async () => {
    const { api, user } = setup([blue, red]);
    await user.click(await screen.findByRole("button", { name: "Delete link Blue Tee Large" }));
    expect(api.mappings.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(api.mappings.remove).toHaveBeenCalledWith(blue.id);
    await waitFor(() => expect(screen.queryByText("Blue Tee")).toBeNull());
  });
});

describe("variants with no link", () => {
  it("counts them, lists them with a Map button and searches them", async () => {
    const unmapped = vi.fn().mockResolvedValue({ total: 340, unmapped: 212, items: [{ variantId: "v9", productTitle: "Green Tee", variantTitle: "Medium", sku: "B0399" }] });
    const { user } = setup([blue], { mappings: { unmapped } });
    expect(await screen.findByText("212 of 340 variants are not mapped")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Map Green Tee Medium" })).toHaveAttribute("href", "/mappings/new?variant=v9");
    await user.type(screen.getByLabelText("Search variants with no link"), "green");
    await waitFor(() => expect(unmapped).toHaveBeenLastCalledWith("green"));
  });

  it("says when every variant is mapped", async () => {
    setup([blue], { mappings: { unmapped: vi.fn().mockResolvedValue({ total: 5, unmapped: 0, items: [] }) } });
    expect(await screen.findByText("Every variant has a link.")).toBeInTheDocument();
  });
});

describe("stock answers", () => {
  const stock = (over: Partial<NonNullable<Mapping["latestStock"]>> = {}) => ({ answer: "in_stock" as const, reason: null, quantity: null, matchedText: "Add to cart", observedAt: "2026-11-10T10:00:00.000Z", ...over });

  it("says when no stock check has run yet", async () => {
    setup([blue]);
    expect(await screen.findByText("No stock check yet")).toBeInTheDocument();
  });

  it("shows the latest answer in words, with the quantity, the region and the reason", async () => {
    setup([
      aMapping({ id: "a", productTitle: "Alpha", latestStock: stock({ quantity: 12 }) }),
      aMapping({ id: "b", productTitle: "Beta", region: "Hull", latestStock: stock({ answer: "out_of_stock", reason: "not_listed" }) }),
      aMapping({ id: "c", productTitle: "Gamma", latestStock: stock({ answer: "cannot_tell", reason: "neither_matched" }) }),
    ]);
    expect(within(await screen.findByRole("row", { name: /Alpha/ })).getByText("In stock (12)")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Beta/ })).getByText("Out of stock: not listed for Hull")).toBeInTheDocument();
    const gamma = within(screen.getByRole("row", { name: /Gamma/ }));
    expect(gamma.getByText("Cannot tell")).toBeInTheDocument();
    expect(gamma.getByText("None of the rules matched.")).toBeInTheDocument();
  });

  it("says a changed page needs the stock rules reviewed, with a link to them", async () => {
    setup([aMapping({ latestStock: stock({ answer: "cannot_tell", reason: "page_changed" }) })]);
    const row = within(await screen.findByRole("row", { name: /Blue Tee/ }));
    expect(row.getByText(/The page changed\. Review the stock rules\./)).toBeInTheDocument();
    expect(row.getByRole("link", { name: "Review stock rules" })).toHaveAttribute("href", `/suppliers/${acme.id}/rules`);
  });

  it("checks stock for one link and says it started, or shows the server's plain reason", async () => {
    const checkLink = vi.fn().mockRejectedValueOnce(new ApiError("Turn on stock rules for this supplier first.", 409, "no_recipe")).mockResolvedValue(undefined);
    const { api, user } = setup([blue], { stock: { checkLink } });
    await user.click(await screen.findByRole("button", { name: "Check stock Blue Tee Large" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Turn on stock rules");
    await user.click(screen.getByRole("button", { name: "Check stock Blue Tee Large" }));
    expect(api.stock.checkLink).toHaveBeenLastCalledWith(blue.id);
    expect(await screen.findByText(/stock check of Blue Tee \(Large\) has started/i)).toBeInTheDocument();
  });

  it("checks all of one supplier's stock once that supplier is chosen", async () => {
    const checkSupplier = vi.fn().mockResolvedValue(3);
    const { user } = setup([blue], { stock: { checkSupplier } });
    await screen.findByText("Blue Tee");
    await user.selectOptions(screen.getByLabelText("Supplier"), acme.id);
    await user.click(await screen.findByRole("button", { name: "Check all stock for Acme Supply" }));
    expect(checkSupplier).toHaveBeenCalledWith(acme.id);
    expect(await screen.findByText(/Checking stock for 3 links/)).toBeInTheDocument();
  });

  it("shows a link's history of stock answers", async () => {
    const observations = vi.fn().mockResolvedValue([
      { id: 2, ...stock({ quantity: 5 }), quantityMismatch: false, recipeVersion: 2, checkResult: "ok" },
      { id: 1, ...stock({ answer: "out_of_stock" }), observedAt: "2026-11-09T10:00:00.000Z", quantityMismatch: false, recipeVersion: 1, checkResult: "ok" },
    ]);
    const { user } = setup([blue], { stock: { observations } });
    await user.click(await screen.findByRole("button", { name: "Show history Blue Tee Large" }));
    const list = await screen.findByRole("list", { name: "Stock history for Blue Tee Large" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("In stock (5)");
    expect(items[0]).toHaveTextContent("rules version 2");
    expect(items[1]).toHaveTextContent("Out of stock");
  });
});

describe("answers that are out of date", () => {
  const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
  const daily = aSupplier({ scheduleIntervalMinutes: 1440 });
  const run = (supplier: ReturnType<typeof aSupplier>, lastLinkCheckAt: string | null) => setup([aMapping({ lastLinkCheckAt })], { suppliers: { list: vi.fn().mockResolvedValue([supplier]) } });

  it("marks a link not checked for more than twice the supplier's interval", async () => {
    run(daily, ago(49));
    expect(await screen.findByText("Not checked recently")).toBeInTheDocument();
  });
  it("does not mark one checked within twice the interval", async () => {
    run(daily, ago(47));
    await screen.findByText("Blue Tee");
    expect(screen.queryByText("Not checked recently")).toBeNull();
  });
  it("does not mark anything when automatic checks are off, or the link was never checked", async () => {
    run(aSupplier(), ago(999));
    await screen.findByText("Blue Tee");
    expect(screen.queryByText("Not checked recently")).toBeNull();
    cleanup();
    run(daily, null);
    await screen.findByText("Blue Tee");
    expect(screen.queryByText("Not checked recently")).toBeNull();
  });
});
