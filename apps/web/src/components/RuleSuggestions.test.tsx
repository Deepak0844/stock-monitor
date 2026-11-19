// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Suggestion, SuggestResult } from "../api.js";
import { RuleSuggestions } from "./RuleSuggestions.js";

afterEach(cleanup);

const base = { seenOn: 1, ofTotal: 1, seenOnOther: 0, otherTotal: 1, starter: true };
const soldOut: Suggestion = { ...base, kind: "outOfStock", rule: { type: "text", text: "Sold out" }, checked: true };
const disabled: Suggestion = { ...base, kind: "outOfStock", rule: { type: "button", label: "Add to cart", enabled: false }, checked: false };
const add: Suggestion = { ...base, kind: "inStock", rule: { type: "button", label: "Add to cart", enabled: true }, checked: true };
const result = (passes: boolean): SuggestResult => ({ ok: true, passes, suggestions: [add, soldOut, disabled] });

describe("RuleSuggestions", () => {
  it("lists rules by group with their evidence, ticked as the engine said", () => {
    render(<RuleSuggestions result={result(true)} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Out of stock when" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Sold out/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /must be disabled/ })).not.toBeChecked();
    expect(screen.getAllByText(/On 1 of 1/).length).toBeGreaterThan(0);
    expect(screen.getByText("These rules pass all your examples.")).toBeInTheDocument();
  });

  it("adds only the ticked rules", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<RuleSuggestions result={result(true)} onAdd={onAdd} onClose={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: /Sold out/ }));
    await user.click(screen.getByRole("checkbox", { name: /must be disabled/ }));
    await user.click(screen.getByRole("button", { name: "Add ticked rules" }));
    expect(onAdd).toHaveBeenCalledWith([add, disabled]);
  });

  it("warns when the ticked rules do not pass every example", () => {
    render(<RuleSuggestions result={result(false)} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("These rules do not pass all your examples. Review before adding.")).toBeInTheDocument();
  });

  it("cannot add with nothing ticked", async () => {
    const user = userEvent.setup();
    render(<RuleSuggestions result={{ ok: true, passes: false, suggestions: [disabled] }} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add ticked rules" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /must be disabled/ }));
    expect(screen.getByRole("button", { name: "Add ticked rules" })).toBeEnabled();
  });

  it("says what to label when a side is missing, and offers no add button", () => {
    render(<RuleSuggestions result={{ ok: false, reason: "need_both_answers" }} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Label one saved page in stock and one out of stock, then try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add ticked rules" })).not.toBeInTheDocument();
  });

  it("says so when nothing stood out, and closes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RuleSuggestions result={{ ok: true, passes: false, suggestions: [] }} onAdd={vi.fn()} onClose={onClose} />);
    expect(screen.getByText(/No rule stood out/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
