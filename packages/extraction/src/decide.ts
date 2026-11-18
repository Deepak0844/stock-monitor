import { availabilityName, pickOffer, type LinkRef } from "./built-in.js";
import { buttonMatches, labelledNumber, regionTable, textMatches } from "./evaluate.js";
import type { Decision, PageDescription, Recipe, Reason, StockRule } from "./types.js";

/** No link: a page tested on its own. Pages that list several options with different stock are then "cannot tell". */
export const NO_LINK: LinkRef = { url: null, option: null };
const tell = (reason: Reason, extra: Partial<Decision> = {}): Decision => ({ answer: "cannot_tell", reason, quantity: null, matchedText: null, quantityMismatch: false, decidedBy: null, ...extra });
const matches = (page: PageDescription, rule: StockRule, main = false) => (rule.type === "text" ? textMatches(page, rule, main) : buttonMatches(page, rule, main));
const firstMatch = (page: PageDescription, rules: StockRule[]): string | null => {
  for (const rule of rules) {
    const hit = matches(page, rule, true);
    if (hit !== null) return hit;
  }
  return null;
};

/**
 * What a page says about stock, by the owner's rules. Pure: the same page and recipe always give the same answer, and the
 * editor's Test button and the real check both call it. The safety rule: it says in stock or out of stock only when the rules
 * matched clearly. Anything else (a changed page, rules that disagree or find nothing) is "cannot tell", never out of stock.
 *
 * Order: page checks, then the region rule, then the page's built-in stock data (when the recipe has it on), then the word
 * rules and quantity. `link` is the link being checked, to pick its offer when the page lists several options.
 */
export function decide(page: PageDescription, recipe: Recipe, region: string | null, link: LinkRef): Decision {
  if (!recipe.pageChecks.every((rule) => matches(page, rule) !== null)) return tell("page_changed");

  if (recipe.region && region) {
    // A missing region only means "not listed" while the rest of the table is there. Without the table, the page has changed.
    if (!regionTable(page, recipe.region.under)) return tell("page_changed");
    const row = labelledNumber(page, region, recipe.region.under);
    if (!row.found) return { answer: "out_of_stock", reason: "not_listed", quantity: null, matchedText: null, quantityMismatch: false, decidedBy: null };
    if (row.quantity === null) return tell("neither_matched", { matchedText: row.line });
    return { answer: row.quantity > 0 ? "in_stock" : "out_of_stock", reason: null, quantity: row.quantity, matchedText: row.line, quantityMismatch: false, decidedBy: null };
  }

  // Why the built-in data did not answer, when it is on: missing from the page, or there but not clear.
  let builtInWhy: Reason | null = null;
  if (recipe.builtIn) {
    const picked = pickOffer(page.offers ?? [], link, recipe.builtIn.waiting);
    if (picked && "answer" in picked) {
      return { answer: picked.answer, reason: null, quantity: null, matchedText: `Built-in data: ${availabilityName(picked.offer.availability)}`, quantityMismatch: false, decidedBy: "built_in" };
    }
    builtInWhy = picked ? picked.unclear : "page_changed";
    // With no word rules to fall back on, a page without built-in data no longer looks like a product page.
    if (recipe.inStock.length === 0 && recipe.outOfStock.length === 0 && !recipe.quantity) return tell(builtInWhy);
  }

  const inHit = firstMatch(page, recipe.inStock);
  const outHit = firstMatch(page, recipe.outOfStock);
  if (inHit !== null && outHit !== null) return tell("both_matched");

  const read = recipe.quantity ? labelledNumber(page, recipe.quantity.label, recipe.quantity.under, true) : null;
  const quantity = read?.found ? read.quantity : null;
  if (inHit === null && outHit === null) {
    // Unclear built-in data says more than "no rule matched" (for example: set this link's option).
    if (quantity === null) return tell(builtInWhy === "variant_unclear" || builtInWhy === "built_in_unclear" ? builtInWhy : "neither_matched");
    return { answer: quantity > 0 ? "in_stock" : "out_of_stock", reason: null, quantity, matchedText: read?.found ? read.line : null, quantityMismatch: false, decidedBy: "rules" };
  }

  const answer = inHit !== null ? "in_stock" : "out_of_stock";
  const matchedText = (inHit ?? outHit) as string;
  if (quantity !== null && (answer === "in_stock") !== (quantity > 0)) return tell("quantity_text_disagree", { quantity, matchedText, quantityMismatch: true });
  return { answer, reason: null, quantity, matchedText, quantityMismatch: false, decidedBy: "rules" };
}
