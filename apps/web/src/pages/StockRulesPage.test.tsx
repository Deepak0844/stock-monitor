// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError, type Capture } from "../api.js";
import { aCapture, aMapping, aRecipeVersion, aSupplier, fakeApi } from "../test/fake-api.js";
import { StockRulesPage } from "./StockRulesPage.js";

beforeEach(() => window.history.replaceState(null, "", "/suppliers/11111111-1111-4111-8111-111111111111/rules"));
afterEach(cleanup);

const acme = aSupplier();
const description = {
  url: "https://shop.acme.example/p",
  title: "Blue Tee",
  status: 200,
  pageClass: "ok",
  sections: [{ heading: "Blue Tee", level: 1, lines: ["Soft cotton.", "<script>alert('x')</script><b>bold</b>"] }],
  buttons: [{ label: "Add to cart", enabled: true, section: "Blue Tee" }],
};

const setup = (over: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi({
    ...over,
    suppliers: { get: vi.fn().mockResolvedValue(acme), ...over.suppliers },
    mappings: { list: vi.fn().mockResolvedValue([aMapping()]), ...over.mappings },
  });
  render(<StockRulesPage api={api} supplierId={acme.id} />);
  return { api, user: userEvent.setup() };
};

describe("saved pages", () => {
  it("says plainly there are none yet", async () => {
    setup();
    expect(await screen.findByText(/No saved pages yet/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Stock rules" })).toBeInTheDocument();
    expect(screen.getByText("Acme Supply")).toBeInTheDocument();
  });

  it("asks for a capture of a chosen link, with an optional name, and says it has started", async () => {
    const { api, user } = setup();
    await user.selectOptions(await screen.findByLabelText("Link to capture"), aMapping().id);
    await user.type(screen.getByLabelText("Name (optional)"), "Blue Tee in stock");
    await user.click(screen.getByRole("button", { name: "Capture a page" }));
    expect(api.captures.request).toHaveBeenCalledWith(acme.id, { mappingId: aMapping().id, name: "Blue Tee in stock" });
    expect(await screen.findByText(/Capturing the page/)).toBeInTheDocument();
  });

  it("asks which link first, and shows the server's plain refusal", async () => {
    const request = vi.fn().mockRejectedValue(new ApiError("You have not recorded permission to check this supplier automatically. Open the supplier to record it.", 409, "no_permission"));
    const { user } = setup({ captures: { request } });
    await user.click(await screen.findByRole("button", { name: "Capture a page" }));
    expect(await screen.findByText("Choose the link whose page you want to capture.")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("Link to capture"), aMapping().id);
    await user.click(screen.getByRole("button", { name: "Capture a page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("recorded permission");
  });

  const list = (...c: Capture[]) => ({ captures: { list: vi.fn().mockResolvedValue(c) } });

  it("shows each capture's state in words: capturing, saved, or why it failed", async () => {
    setup(list(
      aCapture({ id: "a", name: "Pending one", status: "pending", hasPicture: false }),
      aCapture({ id: "b", name: "Ready one" }),
      aCapture({ id: "c", name: "Failed one", status: "failed", failureReason: "captcha", hasPicture: false }),
    ));
    expect(await screen.findByText("Capturing…")).toBeInTheDocument();
    expect(screen.getByText(/The supplier showed a puzzle/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Ready one" })).toBeInTheDocument();
  });

  it("says when a capture was kept because a page changed", async () => {
    setup(list(aCapture({ name: "Page changed", keptReason: "page_changed" })));
    expect(await screen.findByText(/kept because the page changed/i)).toBeInTheDocument();
  });

  it("shows the picture and the page's words as plain text, never as HTML", async () => {
    const get = vi.fn().mockResolvedValue({ ...aCapture(), description });
    const { user } = setup({ ...list(aCapture()), captures: { list: vi.fn().mockResolvedValue([aCapture()]), get } });
    await user.click(await screen.findByRole("button", { name: "View Blue Tee in stock" }));
    expect(await screen.findByRole("img", { name: "Picture of the saved page" })).toHaveAttribute("src", `/api/captures/${aCapture().id}/picture`);
    expect(screen.getByText("Soft cotton.")).toBeInTheDocument();
    expect(screen.getByText("<script>alert('x')</script><b>bold</b>")).toBeInTheDocument();
    expect(document.querySelector("script[src], b")).toBeNull();
    expect(screen.getByText(/Add to cart/)).toBeInTheDocument();
  });

  it("labels a capture with a name and the answer the owner expects", async () => {
    const get = vi.fn().mockResolvedValue({ ...aCapture(), description });
    const { api, user } = setup({ captures: { list: vi.fn().mockResolvedValue([aCapture()]), get } });
    await user.click(await screen.findByRole("button", { name: "View Blue Tee in stock" }));
    await user.selectOptions(await screen.findByLabelText("Answer you expect"), "in_stock");
    await user.click(screen.getByRole("button", { name: "Save label" }));
    expect(api.captures.label).toHaveBeenCalledWith(aCapture().id, { name: "Blue Tee in stock", expected: "in_stock" });
  });

  it("warns that a labelled example holds a picture of the page", async () => {
    setup(list(aCapture({ expectedAnswer: "in_stock" })));
    expect(await screen.findByText(/Contains a picture of the page\. Delete it when you no longer need it\./)).toBeInTheDocument();
  });

  it("asks before deleting, then removes the capture", async () => {
    const { api, user } = setup(list(aCapture(), aCapture({ id: "other", name: "Other" })));
    await user.click(await screen.findByRole("button", { name: "Delete Blue Tee in stock" }));
    expect(screen.getByRole("dialog", { name: "Delete Blue Tee in stock?" })).toHaveTextContent("cannot be recovered");
    expect(api.captures.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete saved page" }));
    expect(api.captures.remove).toHaveBeenCalledWith(aCapture().id);
    await waitFor(() => expect(screen.queryByRole("button", { name: "View Blue Tee in stock" })).toBeNull());
  });
});

describe("the rules", () => {
  it("starts with one empty page check, and builds a recipe from what is filled in", async () => {
    const { api, user } = setup();
    await user.type(await screen.findByLabelText("Page checks rule 1 words"), "Blue Tee");
    await user.click(screen.getByRole("button", { name: "Add a rule to In stock when" }));
    await user.selectOptions(screen.getByLabelText("In stock when rule 1 type"), "button");
    await user.type(screen.getByLabelText("In stock when rule 1 words"), "Add to cart");
    await user.selectOptions(screen.getByLabelText("In stock when rule 1 button must be"), "true");
    await user.click(screen.getByRole("button", { name: "Add a rule to Out of stock when" }));
    await user.type(screen.getByLabelText("Out of stock when rule 1 words"), "Sold out");
    await user.type(screen.getByLabelText("Out of stock when rule 1 only under this heading (optional)"), "Blue Tee");
    await user.click(screen.getByRole("button", { name: "Save version" }));
    expect(api.recipes.save).toHaveBeenCalledWith(acme.id, {
      pageChecks: [{ type: "text", text: "Blue Tee" }],
      inStock: [{ type: "button", label: "Add to cart", enabled: true }],
      outOfStock: [{ type: "text", text: "Sold out", under: "Blue Tee" }],
    });
    expect(await screen.findByText(/Saved as version 1/)).toBeInTheDocument();
  });

  it("can add a quantity rule and a region rule, and remove a rule", async () => {
    const { api, user } = setup();
    await user.type(await screen.findByLabelText("Page checks rule 1 words"), "Blue Tee");
    await user.click(screen.getByLabelText("Read a quantity"));
    await user.type(screen.getByLabelText("Quantity label"), "Units left");
    await user.click(screen.getByLabelText("This supplier lists stock by region"));
    await user.type(screen.getByLabelText("Region table heading"), "Click and collect availability");
    await user.click(screen.getByRole("button", { name: "Add a rule to Page checks" }));
    await user.click(screen.getByRole("button", { name: "Remove Page checks rule 2" }));
    await user.click(screen.getByRole("button", { name: "Save version" }));
    expect(api.recipes.save).toHaveBeenCalledWith(acme.id, {
      pageChecks: [{ type: "text", text: "Blue Tee" }],
      inStock: [],
      outOfStock: [],
      quantity: { label: "Units left" },
      region: { under: "Click and collect availability" },
    });
  });

  it("shows the server's plain message when the rules are not valid", async () => {
    const save = vi.fn().mockRejectedValue(new ApiError("Add at least one page check, so the app can tell when the page changes.", 400, "invalid_recipe"));
    const { user } = setup({ recipes: { save } });
    await user.click(await screen.findByRole("button", { name: "Save version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add at least one page check");
  });

  it("starts from the turned-on version's rules", async () => {
    setup({ recipes: { list: vi.fn().mockResolvedValue([aRecipeVersion({ active: true, version: 2 })]) } });
    await waitFor(() => expect(screen.getByLabelText("Page checks rule 1 words")).toHaveValue("Blue Tee"));
    expect(screen.getByLabelText("In stock when rule 1 words")).toHaveValue("Add to cart");
  });
});

describe("testing and turning on", () => {
  const versions = vi.fn().mockResolvedValue([aRecipeVersion({ version: 3, id: "v3" }), aRecipeVersion({ version: 2, id: "v2", active: true })]);

  it("tests all the examples and says which pass and which do not", async () => {
    const test = vi.fn().mockResolvedValue({
      passed: false,
      results: [
        { id: "a", name: "In stock page", expected: "in_stock", passed: true, got: { answer: "in_stock", reason: null, quantity: null, matchedText: "Add to cart" } },
        { id: "b", name: "Sold out page", expected: "out_of_stock", passed: false, got: { answer: "cannot_tell", reason: "page_changed", quantity: null, matchedText: null } },
      ],
    });
    const { user } = setup({ recipes: { test } });
    await user.click(await screen.findByRole("button", { name: "Test all examples" }));
    expect(await screen.findByText("1 example does not give the answer you expect.")).toBeInTheDocument();
    expect(screen.getByText(/In stock page/).closest("li")).toHaveTextContent("Passed");
    const failed = screen.getByText(/Sold out page/).closest("li")!;
    expect(failed).toHaveTextContent("Failed");
    expect(failed).toHaveTextContent("You expected Out of stock, the rules said Cannot tell");
    expect(failed).toHaveTextContent("The page changed");
  });

  it("says when every example passes", async () => {
    const test = vi.fn().mockResolvedValue({ passed: true, results: [{ id: "a", name: "A", expected: "in_stock", passed: true, got: { answer: "in_stock", reason: null, quantity: null, matchedText: null } }] });
    const { user } = setup({ recipes: { test } });
    await user.click(await screen.findByRole("button", { name: "Test all examples" }));
    expect(await screen.findByText("All examples give the answer you expect.")).toBeInTheDocument();
  });

  it("lists the versions, with the turned-on one marked", async () => {
    setup({ recipes: { list: versions } });
    const list = await screen.findByRole("list", { name: "Versions" });
    expect(within(list).getByText("Version 2")).toBeInTheDocument();
    expect(within(list).getByText("Turned on")).toBeInTheDocument();
  });

  it("will not turn a version on until a saved page is labelled, and says why", async () => {
    setup({ recipes: { list: versions }, captures: { list: vi.fn().mockResolvedValue([aCapture()]) } });
    const button = await screen.findByRole("button", { name: "Turn on version 3" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Label at least one saved page with the answer you expect.")).toBeInTheDocument();
  });

  it("turns a version on once pages are labelled and the examples pass", async () => {
    const test = vi.fn().mockResolvedValue({ passed: true, results: [{ id: "a", name: "A", expected: "in_stock", passed: true, got: { answer: "in_stock", reason: null, quantity: null, matchedText: null } }] });
    const { api, user } = setup({ recipes: { list: versions, test }, captures: { list: vi.fn().mockResolvedValue([aCapture({ expectedAnswer: "in_stock" })]) } });
    await user.click(await screen.findByRole("button", { name: "Test all examples" }));
    await screen.findByText("All examples give the answer you expect.");
    await user.click(screen.getByRole("button", { name: "Turn on version 3" }));
    expect(api.recipes.activate).toHaveBeenCalledWith("v3");
    expect(await screen.findByText(/Version 3 is turned on/)).toBeInTheDocument();
  });

  it("blocks Turn on while the last test had a failing example", async () => {
    const test = vi.fn().mockResolvedValue({ passed: false, results: [{ id: "a", name: "A", expected: "in_stock", passed: false, got: { answer: "cannot_tell", reason: "neither_matched", quantity: null, matchedText: null } }] });
    const { user } = setup({ recipes: { list: versions, test }, captures: { list: vi.fn().mockResolvedValue([aCapture({ expectedAnswer: "in_stock" })]) } });
    await user.click(await screen.findByRole("button", { name: "Test all examples" }));
    await screen.findByText("1 example does not give the answer you expect.");
    expect(screen.getByRole("button", { name: "Turn on version 3" })).toBeDisabled();
    expect(screen.getByText("Some examples do not give the answer you expect. Fix the rules and test again.")).toBeInTheDocument();
  });

  it("shows the server's plain refusal when turning on fails", async () => {
    const activate = vi.fn().mockRejectedValue(new ApiError("These saved pages do not give the answer you expect: A. Fix the rules and test again.", 409, "examples_failed"));
    const { user } = setup({ recipes: { list: versions, activate }, captures: { list: vi.fn().mockResolvedValue([aCapture({ expectedAnswer: "in_stock" })]) } });
    await user.click(await screen.findByRole("button", { name: "Turn on version 3" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("do not give the answer you expect: A");
  });
});

describe("loading problems", () => {
  it("says plainly when the supplier cannot be loaded", async () => {
    setup({ suppliers: { get: vi.fn().mockRejectedValue(new ApiError("That supplier does not exist.", 404, "supplier_not_found")) } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That supplier does not exist.");
  });
});
