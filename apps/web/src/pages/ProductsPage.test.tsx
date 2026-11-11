// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError, type VariantPage, type VariantQuery } from "../api.js";
import { aConnection, aPage, aVariant, fakeApi } from "../test/fake-api.js";
import { ProductsPage } from "./ProductsPage.js";

beforeEach(() => window.history.replaceState(null, "", "/products"));
afterEach(cleanup);

const NOT_TRACKED = "Shopify is not tracking stock for this item, so quantity changes will have no effect.";
const KEEPS_SELLING = "This item keeps selling at 0.";

const setup = (variants: (q: VariantQuery) => Promise<VariantPage>, connection = aConnection({ locationId: "gid://shopify/Location/1", locationName: "Shop floor" })) => {
  const variantsSpy = vi.fn(variants);
  const api = fakeApi({ shopify: { variants: variantsSpy, getConnection: vi.fn().mockResolvedValue(connection) } });
  render(<ProductsPage api={api} />);
  return { variantsSpy, api, user: userEvent.setup() };
};

const some = (n: number) => Array.from({ length: n }, (_, i) => aVariant(i + 1));

describe("loading and failing", () => {
  it("says it is loading, then shows the page heading", async () => {
    setup(async () => aPage(some(2)));
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeInTheDocument();
  });

  it("explains a failure plainly and offers to try again", async () => {
    const variants = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0)).mockResolvedValue(aPage(some(1)));
    const { user } = setup(variants);
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Product 1")).toBeInTheDocument();
  });
});

describe("when there is nothing to show", () => {
  it("points to Settings when Shopify is not connected", async () => {
    const { api } = setup(async () => aPage([]), null as never);
    expect(await screen.findByText("No products yet. Connect Shopify in Settings.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Shopify settings" })).toHaveAttribute("href", "/settings/shopify");
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(api.shopify.variants).toHaveBeenCalled();
  });

  it("asks for a sync when Shopify is connected but nothing has been imported", async () => {
    setup(async () => aPage([]));
    expect(await screen.findByText("No products have been imported yet. Sync from Shopify in Settings.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Shopify settings" })).toBeInTheDocument();
  });
});

describe("the list", () => {
  it("is a real table with named columns", async () => {
    setup(async () => aPage(some(2)));
    const table = await screen.findByRole("table", { name: "Products from Shopify" });
    for (const name of ["Product", "Variant", "SKU", "Available", "Notes"]) {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header and two products
  });

  it("shows each variant's product, variant, SKU and stock", async () => {
    setup(async () => aPage([aVariant(1, { productTitle: "Garden Gloves", variantTitle: "Large", sku: "GLV-L", available: 7 })]));
    const row = (await screen.findByText("Garden Gloves")).closest("tr")!;
    expect(within(row).getByText("Large")).toBeInTheDocument();
    expect(within(row).getByText("GLV-L")).toBeInTheDocument();
    expect(within(row).getByText("7")).toBeInTheDocument();
  });

  it("says 'No SKU' when there is none, and 'Only variant' for a product with a single default variant", async () => {
    setup(async () => aPage([aVariant(1, { sku: null, variantTitle: "Default Title" })]));
    expect(await screen.findByText("No SKU")).toBeInTheDocument();
    expect(screen.getByText("Only variant")).toBeInTheDocument();
    expect(screen.queryByText("Default Title")).not.toBeInTheDocument();
  });

  it("tells stock that is not held at the location from a real zero", async () => {
    setup(async () => aPage([aVariant(1, { available: null, productTitle: "Unheld" }), aVariant(2, { available: 0, productTitle: "Empty" })]));
    const unheld = (await screen.findByText("Unheld")).closest("tr")!;
    const empty = screen.getByText("Empty").closest("tr")!;
    expect(within(unheld).getByText("Not stocked here")).toBeInTheDocument();
    expect(within(empty).getByText("0")).toBeInTheDocument();
    expect(within(empty).queryByText("Not stocked here")).not.toBeInTheDocument();
  });

  it("writes every warning in words, so nothing depends on colour", async () => {
    setup(async () =>
      aPage([
        aVariant(1, { productTitle: "Loose", tracked: false, warnings: [{ code: "not_tracked", message: NOT_TRACKED }] }),
        aVariant(2, { productTitle: "Endless", inventoryPolicy: "CONTINUE", warnings: [{ code: "continue_selling", message: KEEPS_SELLING }] }),
        aVariant(3, { productTitle: "Fine" }),
      ]),
    );
    expect(await screen.findByText(NOT_TRACKED)).toBeInTheDocument();
    expect(screen.getByText(KEEPS_SELLING)).toBeInTheDocument();
    const fine = screen.getByText("Fine").closest("tr")!;
    expect(within(fine).getByText("None")).toBeInTheDocument();
  });

  it("says where the stock figures come from", async () => {
    setup(async () => aPage(some(1)));
    expect(await screen.findByText(/stock shown is available at shop floor/i)).toBeInTheDocument();
  });

  it("says how many are shown", async () => {
    setup(async () => aPage(some(2)));
    expect(await screen.findByText("Showing 1–2 of 2")).toBeInTheDocument();
  });
});

describe("searching", () => {
  it("searches after a short pause in typing, goes back to page one and keeps the search in the address", async () => {
    const { variantsSpy, user } = setup(async () => aPage(some(2)));
    await screen.findByText("Product 1");
    await user.type(screen.getByRole("searchbox", { name: "Search products" }), "glove");
    expect(variantsSpy).toHaveBeenCalledTimes(1); // typing alone sends nothing yet
    await waitFor(() => expect(variantsSpy).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, search: "glove", warningsOnly: false }));
    expect(window.location.search).toBe("?search=glove");
  });

  it("says when nothing matches, and clears the search", async () => {
    const variants = vi.fn(async (q: VariantQuery) => (q.search ? aPage([]) : aPage(some(2))));
    const { variantsSpy, user } = setup(variants);
    await screen.findByText("Product 1");
    await user.type(screen.getByRole("searchbox", { name: "Search products" }), "zzz");
    expect(await screen.findByText("No products match your search.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByText("Product 1")).toBeInTheDocument();
    expect(variantsSpy).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, search: undefined, warningsOnly: false });
    expect(screen.getByRole("searchbox", { name: "Search products" })).toHaveValue("");
  });
});

describe("the attention filter", () => {
  it("shows only items that need attention, and keeps that in the address", async () => {
    const { variantsSpy, user } = setup(async () => aPage(some(2)));
    await screen.findByText("Product 1");
    await user.click(screen.getByRole("checkbox", { name: "Show only items that need attention" }));
    expect(variantsSpy).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, search: undefined, warningsOnly: true });
    expect(window.location.search).toBe("?attention=1");
  });

  it("explains an empty result for the filter", async () => {
    const variants = vi.fn(async (q: VariantQuery) => (q.warningsOnly ? aPage([]) : aPage(some(2))));
    const { user } = setup(variants);
    await screen.findByText("Product 1");
    await user.click(screen.getByRole("checkbox", { name: "Show only items that need attention" }));
    expect(await screen.findByText("No items need attention.")).toBeInTheDocument();
  });

  it("combines with a search", async () => {
    const { variantsSpy, user } = setup(async () => aPage(some(2)));
    await screen.findByText("Product 1");
    await user.type(screen.getByRole("searchbox", { name: "Search products" }), "glove");
    await user.click(screen.getByRole("checkbox", { name: "Show only items that need attention" }));
    await waitFor(() => expect(variantsSpy).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, search: "glove", warningsOnly: true }));
  });

  it("opens with the search, filter and page from the address", async () => {
    window.history.replaceState(null, "", "/products?search=hose&attention=1&page=2");
    const { variantsSpy } = setup(async () => aPage(some(2), { total: 60, page: 2 }));
    await waitFor(() => expect(variantsSpy).toHaveBeenCalledWith({ page: 2, pageSize: 25, search: "hose", warningsOnly: true }));
    expect(screen.getByRole("searchbox", { name: "Search products" })).toHaveValue("hose");
    expect(screen.getByRole("checkbox", { name: "Show only items that need attention" })).toBeChecked();
  });
});

describe("paging", () => {
  // 60 variants in pages of 25, so the last page holds 10, as the real API returns.
  const big = async (q: VariantQuery) => {
    const first = (q.page - 1) * 25;
    const count = Math.min(25, 60 - first);
    return aPage(Array.from({ length: count }, (_, i) => aVariant(first + i + 1)), { total: 60, page: q.page });
  };

  it("shows where the owner is and moves forward and back, keeping the page in the address", async () => {
    const { variantsSpy, user } = setup(big);
    expect(await screen.findByText("Showing 1–25 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Showing 26–50 of 60")).toBeInTheDocument();
    expect(variantsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(window.location.search).toBe("?page=2");
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("Showing 1–25 of 60")).toBeInTheDocument();
  });

  it("stops at the last page", async () => {
    const { user } = setup(big);
    await screen.findByText("Showing 1–25 of 60");
    await user.click(screen.getByRole("button", { name: "Page 3" }));
    expect(await screen.findByText("Showing 51–60 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("lets the owner choose how many to show on a page", async () => {
    const { variantsSpy, user } = setup(big);
    await screen.findByText("Showing 1–25 of 60");
    await user.selectOptions(screen.getByLabelText("Rows per page"), "50");
    await waitFor(() => expect(variantsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 50 })));
  });

  it("has nothing to page through when everything fits on one page", async () => {
    setup(async () => aPage(some(3)));
    expect(await screen.findByText("Showing 1–3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("keeps showing the current page, dimmed and marked busy, while the next one loads", async () => {
    let release!: (p: VariantPage) => void;
    const variants = vi.fn((q: VariantQuery) => (q.page === 2 ? new Promise<VariantPage>((r) => (release = r)) : big(q)));
    const { user } = setup(variants);
    await screen.findByText("Showing 1–25 of 60");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("table", { name: "Products from Shopify" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Product 1")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search products" })).toBeInTheDocument();
    release(await big({ page: 2, pageSize: 25 }));
    expect(await screen.findByText("Showing 26–50 of 60")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Products from Shopify" })).toHaveAttribute("aria-busy", "false");
  });

  it("ignores an answer that arrives after a newer request", async () => {
    let releaseSlow!: (p: VariantPage) => void;
    const variants = vi.fn((q: VariantQuery) => {
      if (q.search === "slow") return new Promise<VariantPage>((r) => (releaseSlow = r));
      if (q.search === "fast") return Promise.resolve(aPage([aVariant(2, { productTitle: "Fast result" })]));
      return Promise.resolve(aPage(some(1)));
    });
    const { variantsSpy, user } = setup(variants);
    const box = await screen.findByRole("searchbox", { name: "Search products" });
    await user.type(box, "slow");
    await waitFor(() => expect(variantsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: "slow" })));
    await user.clear(box);
    await user.type(box, "fast");
    expect(await screen.findByText("Fast result")).toBeInTheDocument();
    releaseSlow(aPage([aVariant(9, { productTitle: "Slow result" })]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Fast result")).toBeInTheDocument();
    expect(screen.queryByText("Slow result")).not.toBeInTheDocument();
  });
});

describe("supplier fields from Shopify", () => {
  it("shows each product's supplier name and page address, and a dash when it has none", async () => {
    setup(async () => aPage([aVariant(1, { supplierName: "Acme Foods", supplierUrl: "https://acme.example/p/1" }), aVariant(2)]));
    await screen.findByText("Acme Foods");
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("Acme Foods")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("https://acme.example/p/1")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("No supplier in Shopify")).toBeInTheDocument();
  });
});
