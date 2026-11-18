// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { emptyDraft, RuleEditor, toDraft, toRecipe, type Draft } from "./RuleEditor.js";
import { ruleLines } from "./ruleWords.js";
import { reasonWords } from "./stockWords.js";

afterEach(cleanup);
const words = { pageChecks: [{ type: "text" as const, text: "Blue Tee" }], inStock: [], outOfStock: [] };

describe("built-in data in the draft", () => {
  it("a new draft uses built-in data, pre-order counting as out of stock", () => {
    expect(toRecipe(emptyDraft())).toEqual({ pageChecks: [], inStock: [], outOfStock: [], builtIn: { waiting: "out_of_stock" } });
  });
  it("a saved version without built-in data opens with it off, as saved", () => {
    expect(toDraft(words).builtIn.on).toBe(false);
    expect(toRecipe(toDraft(words))).toEqual(words);
  });
  it("keeps the waiting choice of a saved version", () => {
    const draft = toDraft({ ...words, builtIn: { waiting: "in_stock" } });
    expect(draft.builtIn).toEqual({ on: true, waiting: "in_stock" });
    expect(toRecipe(draft).builtIn).toEqual({ waiting: "in_stock" });
  });
});

describe("the built-in data panel", () => {
  const setup = (draft: Draft = emptyDraft()) => {
    const onChange = vi.fn();
    render(<RuleEditor draft={draft} onChange={onChange} />);
    return { onChange, user: userEvent.setup() };
  };

  it("shows the switch, the waiting choice, and heads the word rules as the fallback", () => {
    setup();
    expect(screen.getByRole("switch", { name: "Use the stock data built into the supplier's pages" })).toBeChecked();
    const waiting = screen.getByLabelText("Pre-order and back-order count as");
    expect([...(waiting as HTMLSelectElement).options].map((o) => o.text)).toEqual(["Out of stock", "In stock", "Cannot tell"]);
    expect(screen.getByText("If the built-in data is missing or unclear")).toBeInTheDocument();
    expect(screen.getByText(/Page checks are optional while built-in data is on\./)).toBeInTheDocument();
  });

  it("changes the waiting choice and turns built-in data off", async () => {
    const { onChange, user } = setup();
    await user.selectOptions(screen.getByLabelText("Pre-order and back-order count as"), "cannot_tell");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ builtIn: { on: true, waiting: "cannot_tell" } }));
    await user.click(screen.getByRole("switch", { name: "Use the stock data built into the supplier's pages" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ builtIn: { on: false, waiting: "out_of_stock" } }));
  });

  it("hides the waiting choice and the fallback heading when off", () => {
    setup(toDraft(words));
    expect(screen.queryByLabelText("Pre-order and back-order count as")).toBeNull();
    expect(screen.queryByText("If the built-in data is missing or unclear")).toBeNull();
  });
});

describe("words for built-in data", () => {
  it("explains the two new reasons", () => {
    expect(reasonWords("variant_unclear")).toBe("The page lists several options with different stock. Set this link's option on the Links page.");
    expect(reasonWords("built_in_unclear")).toBe("The built-in stock data gives a value the app does not count as in or out of stock.");
  });
  it("lists built-in data in a version's rules", () => {
    expect(ruleLines({ ...words, builtIn: { waiting: "out_of_stock" } })["Built-in data"]).toEqual(["On. Pre-order and back-order count as Out of stock."]);
  });
});
