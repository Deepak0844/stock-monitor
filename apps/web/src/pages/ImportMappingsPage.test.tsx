// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError, type ImportColumns, type ImportPreview, type MappingsApi } from "../api.js";
import { fakeApi } from "../test/fake-api.js";
import { ImportMappingsPage } from "./ImportMappingsPage.js";

beforeEach(() => window.history.replaceState(null, "", "/mappings/import"));
afterEach(cleanup);

const columns: ImportColumns = {
  header: ["Handle", "Title", "Variant SKU", "Supplier name", "Conversation starters"],
  suggested: { handle: 0, sku: 2, supplier: 3, address: 4 },
  rowCount: 6,
};
const preview: ImportPreview = {
  previewId: "p1",
  goodCount: 2,
  sample: [{ line: 2, sku: "S1", url: "https://shop.acme.example/p/1" }],
  skippedSuppliers: 48,
  counts: { new: 1, replace: 1, unchanged: 0 },
  problems: [{ line: 5, sku: "B0361", message: "SKU B0361 matches no variant." }],
  problemCount: 1,
  warnings: [],
};
const file = (text = "Handle,Title\n") => new File([text], "products_export.csv", { type: "text/csv" });

const setup = (over: Partial<MappingsApi> = {}) => {
  const api = fakeApi({ mappings: { importColumns: vi.fn().mockResolvedValue(columns), importPreview: vi.fn().mockResolvedValue(preview), importConfirm: vi.fn().mockResolvedValue({ created: 1, updated: 1, unchanged: 0, skipped: 0 }), ...over } });
  render(<ImportMappingsPage api={api} />);
  return { api, user: userEvent.setup() };
};
const choose = async (user: ReturnType<typeof userEvent.setup>, f = file()) => {
  await user.upload(screen.getByLabelText("Shopify product export (CSV)"), f);
};

describe("import", () => {
  it("reads the file, shows the suggested columns and lets the owner change them", async () => {
    const { api, user } = setup();
    await choose(user);
    expect(await screen.findByLabelText("SKU column")).toHaveValue("2");
    expect(screen.getByLabelText("Supplier name column")).toHaveValue("3");
    expect(screen.getByLabelText("Page address column")).toHaveValue("4");
    expect(screen.getByLabelText("Product handle column")).toHaveValue("0");
    expect(api.mappings.importColumns).toHaveBeenCalledWith("Handle,Title\n");
    await user.selectOptions(screen.getByLabelText("Page address column"), "1");
    await user.click(screen.getByRole("button", { name: "Show preview" }));
    await waitFor(() => expect(api.mappings.importPreview).toHaveBeenCalledWith("Handle,Title\n", { handle: 0, sku: 2, supplier: 3, address: 1 }));
  });

  it("shows counts, skipped rows and every problem in plain words, before anything is saved", async () => {
    const { api, user } = setup();
    await choose(user);
    await user.click(await screen.findByRole("button", { name: "Show preview" }));
    expect(await screen.findByText("2 links are ready to save")).toBeInTheDocument();
    expect(screen.getByText(/1 new, 1 replaced, 0 unchanged/)).toBeInTheDocument();
    expect(screen.getByText("48 rows are for suppliers not in the app.")).toBeInTheDocument();
    expect(screen.getByText(/Line 5.*SKU B0361 matches no variant\./)).toBeInTheDocument();
    expect(api.mappings.importConfirm).not.toHaveBeenCalled();
  });

  it("saves on confirm and offers to check the links", async () => {
    const { api, user } = setup();
    await choose(user);
    await user.click(await screen.findByRole("button", { name: "Show preview" }));
    await user.click(await screen.findByRole("button", { name: "Save 2 links" }));
    expect(api.mappings.importConfirm).toHaveBeenCalledWith("p1");
    expect(await screen.findByText(/1 new link saved, 1 replaced/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to links" })).toHaveAttribute("href", "/mappings");
  });

  it("says plainly when the file cannot be read", async () => {
    const { user } = setup({ importColumns: vi.fn().mockRejectedValue(new ApiError("That file is too big. The limit is 10 MB.", 400, "invalid_file")) });
    await choose(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("too big");
  });

  it("says when no rows are good and offers no save", async () => {
    const { user } = setup({ importPreview: vi.fn().mockResolvedValue({ ...preview, goodCount: 0, counts: { new: 0, replace: 0, unchanged: 0 }, sample: [] }) });
    await choose(user);
    await user.click(await screen.findByRole("button", { name: "Show preview" }));
    expect(await screen.findByText(/No rows can be saved/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});
