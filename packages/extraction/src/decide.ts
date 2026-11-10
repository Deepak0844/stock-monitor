import { buttonMatches, labelledNumber, regionTable, textMatches } from "./evaluate.js";
import type { Decision, PageDescription, Recipe, Reason, StockRule } from "./types.js";

const tell = (reason: Reason, extra: Partial<Decision> = {}): Decision => ({ answer: "cannot_tell", reason, quantity: null, matchedText: null, quantityMismatch: false, ...extra });
const matches = (page: PageDescription, rule: StockRule) => (rule.type === "text" ? textMatches(page, rule) : buttonMatches(page, rule));
const firstMatch = (page: PageDescription, rules: StockRule[]): string | null => {
  for (const rule of rules) {
    const hit = matches(page, rule);
    if (hit !== null) return hit;
  }
  return null;
};

/**
 * What a page says about stock, by the owner's rules. Pure: the same page and recipe always give the same answer, and the
 * editor's Test button and the real check both call it. The safety rule: it says in stock or out of stock only when the rules
 * matched clearly. Anything else (a changed page, rules that disagree or find nothing) is "cannot tell", never out of stock.
 */
export function decide(page: PageDescription, recipe: Recipe, region: string | null): Decision {
  if (!recipe.pageChecks.every((rule) => matches(page, rule) !== null)) return tell("page_changed");

  if (recipe.region && region) {
    // A missing region only means "not listed" while the rest of the table is there. Without the table, the page has changed.
    if (!regionTable(page, recipe.region.under)) return tell("page_changed");
    const row = labelledNumber(page, region, recipe.region.under);
    if (!row.found) return { answer: "out_of_stock", reason: "not_listed", quantity: null, matchedText: null, quantityMismatch: false };
    if (row.quantity === null) return tell("neither_matched", { matchedText: row.line });
    return { answer: row.quantity > 0 ? "in_stock" : "out_of_stock", reason: null, quantity: row.quantity, matchedText: row.line, quantityMismatch: false };
  }

  const inHit = firstMatch(page, recipe.inStock);
  const outHit = firstMatch(page, recipe.outOfStock);
  if (inHit !== null && outHit !== null) return tell("both_matched");

  const read = recipe.quantity ? labelledNumber(page, recipe.quantity.label, recipe.quantity.under) : null;
  const quantity = read?.found ? read.quantity : null;
  if (inHit === null && outHit === null) {
    if (quantity === null) return tell("neither_matched");
    return { answer: quantity > 0 ? "in_stock" : "out_of_stock", reason: null, quantity, matchedText: read?.found ? read.line : null, quantityMismatch: false };
  }

  const answer = inHit !== null ? "in_stock" : "out_of_stock";
  const matchedText = (inHit ?? outHit) as string;
  if (quantity !== null && (answer === "in_stock") !== (quantity > 0)) return tell("quantity_text_disagree", { quantity, matchedText, quantityMismatch: true });
  return { answer, reason: null, quantity, matchedText, quantityMismatch: false };
}
