// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../api.js";
import { aMapping, aSupplier, fakeApi } from "../test/fake-api.js";
import { MappingFormPage } from "./MappingFormPage.js";

beforeEach(() => window.history.replaceState(null, "", "/mappings/new"));
afterEach(cleanup);

const items = [
  { variantId: "v1", productTitle: "Blue Tee", variantTitle: "Large", sku: "B0361" },
  { variantId: "v2", productTitle: "Red Tee", variantTitle: "Small", sku: "B0362" },
];
const globex = aSupplier({ id: "22222222-2222-4222-8222-222222222222", name: "Globex" });

const setup = (over: Parameters<typeof fakeApi>[0] = {}, props: { id?: string } = {}) => {
  const api = fakeApi({
    ...over,
    suppliers: { list: vi.fn().mockResolvedValue([aSupplier(), globex]), ...over.suppliers },
    mappings: { unmapped: vi.fn().mockResolvedValue({ total: 2, unmapped: 2, items }), ...over.mappings },
  });
  render(<MappingFormPage api={api} {...props} />);
  return { api, user: userEvent.setup() };
};

describe("adding a link", () => {
  it("saves the chosen variant, supplier, page address and note, then goes back to the list", async () => {
    const { api, user } = setup();
    await screen.findByRole("option", { name: /Blue Tee/ });
    await user.selectOptions(screen.getByLabelText("Variant"), "v1");
    await user.selectOptions(screen.getByLabelText("Supplier"), aSupplier().id);
    await user.type(screen.getByLabelText("Supplier page address"), "https://shop.acme.example/p/blue");
    await user.type(screen.getByLabelText("Note (optional)"), "main page");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await waitFor(() => expect(api.mappings.create).toHaveBeenCalledWith({ variantId: "v1", supplierId: aSupplier().id, url: "https://shop.acme.example/p/blue", note: "main page" }));
    expect(window.location.pathname).toBe("/mappings");
  });

  it("puts a plain message beside each empty field, and saves nothing", async () => {
    const { api, user } = setup();
    await screen.findByRole("option", { name: /Blue Tee/ });
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByText("Choose the variant this link is for.")).toBeInTheDocument();
    expect(screen.getByText("Choose the supplier.")).toBeInTheDocument();
    expect(screen.getByText(/Enter the address of the supplier's page, starting with https:\/\//)).toBeInTheDocument();
    expect(api.mappings.create).not.toHaveBeenCalled();
  });

  it("preselects the variant from the Map button", async () => {
    window.history.replaceState(null, "", "/mappings/new?variant=v2");
    setup();
    await screen.findByRole("option", { name: /Red Tee/ });
    expect(screen.getByLabelText("Variant")).toHaveValue("v2");
  });

  it("searches the variants that have no link", async () => {
    const unmapped = vi.fn().mockResolvedValue({ total: 2, unmapped: 2, items });
    const { user } = setup({ mappings: { unmapped } });
    await screen.findByRole("option", { name: /Blue Tee/ });
    await user.type(screen.getByLabelText("Find a variant"), "red");
    await waitFor(() => expect(unmapped).toHaveBeenLastCalledWith("red"));
  });

  it.each([
    ["wrong_site", "That address is not on this supplier's website.", "Supplier page address"],
    ["invalid_url", "Enter the address starting with https://.", "Supplier page address"],
    ["already_mapped", "This variant already has a link. Edit or delete it instead.", "Variant"],
  ])("shows the server's %s message beside the right field", async (code, text, field) => {
    const create = vi.fn().mockRejectedValue(new ApiError(text, 400, code));
    const { user } = setup({ mappings: { create } });
    await screen.findByRole("option", { name: /Blue Tee/ });
    await user.selectOptions(screen.getByLabelText("Variant"), "v1");
    await user.selectOptions(screen.getByLabelText("Supplier"), aSupplier().id);
    await user.type(screen.getByLabelText("Supplier page address"), "https://shop.acme.example/p");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByLabelText(field)).toHaveAttribute("aria-invalid", "true");
  });
});

describe("editing a link", () => {
  it("shows the variant and supplier as text, and sends only what changed", async () => {
    const { api, user } = setup({ mappings: { get: vi.fn().mockResolvedValue(aMapping({ note: "old" })) } }, { id: aMapping().id });
    expect(await screen.findByText("Blue Tee · Large")).toBeInTheDocument();
    expect(screen.queryByLabelText("Variant")).toBeNull();
    const url = screen.getByLabelText("Supplier page address");
    await user.clear(url);
    await user.type(url, "https://shop.acme.example/p/new");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.mappings.update).toHaveBeenCalledWith(aMapping().id, { url: "https://shop.acme.example/p/new" }));
  });

  it("warns that a new address starts the link's history again", async () => {
    setup({}, { id: aMapping().id });
    expect(await screen.findByText(/starts the link's history again/)).toBeInTheDocument();
  });

  it("shows a plain error when the link cannot be loaded", async () => {
    setup({ mappings: { get: vi.fn().mockRejectedValue(new ApiError("That link does not exist.", 404, "mapping_not_found")) } }, { id: "x" });
    expect(await screen.findByRole("alert")).toHaveTextContent("That link does not exist.");
  });
});

describe("region", () => {
  it("adds an optional region to a new link", async () => {
    const { api, user } = setup();
    await screen.findByRole("option", { name: /Blue Tee/ });
    await user.selectOptions(screen.getByLabelText("Variant", { exact: true }), "v1");
    await user.selectOptions(screen.getByLabelText("Supplier", { exact: true }), aSupplier().id);
    await user.type(screen.getByLabelText("Supplier page address"), "https://shop.acme.example/p/blue");
    await user.type(screen.getByLabelText("Region (optional)"), "Hull");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await waitFor(() => expect(api.mappings.create).toHaveBeenCalledWith(expect.objectContaining({ region: "Hull" })));
  });

  it("leaves the region out when it is empty, so the supplier's default is used", async () => {
    const { api, user } = setup();
    await screen.findByRole("option", { name: /Blue Tee/ });
    await user.selectOptions(screen.getByLabelText("Variant", { exact: true }), "v1");
    await user.selectOptions(screen.getByLabelText("Supplier", { exact: true }), aSupplier().id);
    await user.type(screen.getByLabelText("Supplier page address"), "https://shop.acme.example/p/blue");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await waitFor(() => expect(api.mappings.create).toHaveBeenCalledWith({ variantId: "v1", supplierId: aSupplier().id, url: "https://shop.acme.example/p/blue", note: null }));
  });

  it("changes only the region of an existing link, and clears it", async () => {
    const { api, user } = setup({ mappings: { get: vi.fn().mockResolvedValue(aMapping({ region: "Hull" })) } }, { id: aMapping().id });
    const region = await screen.findByLabelText("Region (optional)");
    expect(region).toHaveValue("Hull");
    await user.clear(region);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.mappings.update).toHaveBeenCalledWith(aMapping().id, { region: null }));
  });
});

describe("a link set from Shopify", () => {
  it("warns on the edit page that the next sync puts Shopify's values back", async () => {
    window.history.replaceState(null, "", "/mappings/44444444-4444-4444-8444-444444444444/edit");
    const { api } = setup({ mappings: { get: vi.fn().mockResolvedValue(aMapping({ shopifyManaged: true })) } as never }, { id: "44444444-4444-4444-8444-444444444444" });
    expect(await screen.findByText(/This link is set from Shopify/)).toBeInTheDocument();
    expect(screen.getByText(/the next Sync puts Shopify's supplier and page address back/)).toBeInTheDocument();
    expect(api.mappings.get).toHaveBeenCalled();
  });

  it("shows no warning on an ordinary link", async () => {
    setup({ mappings: { get: vi.fn().mockResolvedValue(aMapping()) } as never }, { id: "44444444-4444-4444-8444-444444444444" });
    await screen.findByLabelText("Supplier page address");
    expect(screen.queryByText(/This link is set from Shopify/)).not.toBeInTheDocument();
  });
});
