import { buttonMatches, scopeLines, textMatches } from "./evaluate.js";
import { allPass, runExamples, type Example } from "./testing.js";
import type { PageDescription, Recipe, StockRule } from "./types.js";
import { normaliseWords } from "./validate.js";

export type SuggestionKind = "pageCheck" | "inStock" | "outOfStock";

export type Suggestion = {
  kind: SuggestionKind;
  rule: StockRule;
  /** Labelled pages of the matching answer that contain it, and how many there are. For a page check: all in and out pages. */
  seenOn: number;
  ofTotal: number;
  /** Pages of the opposite answer that contain it, and how many there are. Always 0 for a suggested stock rule. */
  seenOnOther: number;
  otherTotal: number;
  /** Matches a built-in common phrase. */
  starter: boolean;
  /** Ticked by default: the smallest set that covers every page of that answer. Page checks: the first 3. */
  checked: boolean;
};

export type SuggestResult = { ok: false; reason: "need_both_answers" } | { ok: true; suggestions: Suggestion[]; passes: boolean };

/** Common wording. It only lifts a candidate's rank; it never creates a suggestion on its own. */
export const STARTER_PHRASES = {
  inStock: ["add to cart", "add to basket", "add to bag", "in stock", "buy now"],
  outOfStock: ["sold out", "out of stock", "currently unavailable", "temporarily unavailable", "notify me", "email me when", "back in stock"],
};

const MAX_PER_KIND = 5;
const MAX_CHECKED_PAGE_CHECKS = 3;
const MAX_WORDS = 80;
const STARTER_BOOST = 0.5;
const LENGTH_PENALTY = 200;

const PRICE = /[£$€₹¥]\s?\d|\d\s?[£$€₹¥]|\d+[.,]\d{2}\b/;
const DATE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/;
const ONLY_NUMBERS = /^[\d\s.,:+\-–/]+$/;
/** A line worth suggesting: short, and not a price, a date or a bare number. */
const usable = (text: string) => text.length > 0 && text.length <= MAX_WORDS && !PRICE.test(text) && !DATE.test(text) && !ONLY_NUMBERS.test(text);

const wordsOf = (rule: StockRule) => (rule.type === "text" ? rule.text : rule.label);
const keyOf = (rule: StockRule) => (rule.type === "text" ? `t|${normaliseWords(rule.text)}` : `b|${normaliseWords(rule.label)}|${rule.enabled ?? ""}`);
const ownHeading = (p: PageDescription) => p.sections.find((s) => s.level === 1 && s.heading !== null)?.heading ?? null;
const hits = (p: PageDescription, rule: StockRule, main: boolean) => (rule.type === "text" ? textMatches(p, rule, main) : buttonMatches(p, rule, main)) !== null;

/**
 * Every line and button of the pages as a rule. The real matchers decide later where each one counts, so a line under a
 * related-products heading never counts for a stock rule. The product's own heading is skipped: it differs by product.
 */
function pool(examples: Example[], withEnabled: boolean): Map<string, StockRule> {
  const found = new Map<string, StockRule>();
  const add = (rule: StockRule) => found.has(keyOf(rule)) || found.set(keyOf(rule), rule);
  for (const { page } of examples) {
    const skip = ownHeading(page) === null ? null : normaliseWords(ownHeading(page) as string);
    for (const line of scopeLines(page, undefined, false)) {
      const text = line.trim();
      if (usable(text) && normaliseWords(text) !== skip) add({ type: "text", text });
    }
    for (const b of page.buttons) {
      const label = b.label.trim();
      if (usable(label)) add(withEnabled ? { type: "button", label, enabled: b.enabled } : { type: "button", label });
    }
  }
  return found;
}

type Ranked = { rule: StockRule; covers: Set<number>; starter: boolean; score: number };

/** Rules seen only on pages of this answer, best first. `qualifying` is every such rule before the cap. */
function stockRules(kind: "inStock" | "outOfStock", own: Example[], other: Example[]): { list: Suggestion[]; qualifying: Set<string> } {
  const ranked: Ranked[] = [];
  for (const rule of pool(own, true).values()) {
    const covers = new Set(own.flatMap((e, i) => (hits(e.page, rule, true) ? [i] : [])));
    if (covers.size === 0 || other.some((e) => hits(e.page, rule, true))) continue;
    const starter = STARTER_PHRASES[kind].some((p) => normaliseWords(wordsOf(rule)).includes(p));
    ranked.push({ rule, covers, starter, score: covers.size / own.length + (starter ? STARTER_BOOST : 0) - wordsOf(rule).length / LENGTH_PENALTY });
  }
  ranked.sort((a, b) => b.score - a.score || wordsOf(a.rule).length - wordsOf(b.rule).length || keyOf(a.rule).localeCompare(keyOf(b.rule)));
  const covered = new Set<number>();
  const list = ranked.slice(0, MAX_PER_KIND).map((r): Suggestion => {
    const checked = [...r.covers].some((i) => !covered.has(i));
    r.covers.forEach((i) => covered.add(i));
    return { kind, rule: r.rule, seenOn: r.covers.size, ofTotal: own.length, seenOnOther: 0, otherTotal: other.length, starter: r.starter, checked };
  });
  return { list, qualifying: new Set(ranked.map((r) => normaliseWords(wordsOf(r.rule)))) };
}

/** Lines and buttons on every in and out page, apart from the product title and anything that looks like a stock rule. */
function pageChecks(labelled: Example[], skip: Set<string>): Suggestion[] {
  const titles = new Set(labelled.flatMap((e) => (ownHeading(e.page) === null ? [] : [normaliseWords(ownHeading(e.page) as string)])));
  const rules = [...pool(labelled, false).values()]
    .filter((rule) => !titles.has(normaliseWords(wordsOf(rule))) && !skip.has(normaliseWords(wordsOf(rule))) && labelled.every((e) => hits(e.page, rule, false)))
    .sort((a, b) => wordsOf(a).length - wordsOf(b).length || keyOf(a).localeCompare(keyOf(b)))
    .slice(0, MAX_PER_KIND);
  return rules.map((rule, i) => ({ kind: "pageCheck", rule, seenOn: labelled.length, ofTotal: labelled.length, seenOnOther: 0, otherTotal: 0, starter: false, checked: i < MAX_CHECKED_PAGE_CHECKS }));
}

/**
 * Proposes rules from the owner's labelled pages. Pure and deterministic, and it uses the same matchers as a real check, so a
 * suggestion means here what it will mean there. `passes` says whether the ticked rules give every labelled page its answer.
 */
export function suggestRules(examples: Example[]): SuggestResult {
  const ins = examples.filter((e) => e.expected === "in_stock");
  const outs = examples.filter((e) => e.expected === "out_of_stock");
  if (ins.length === 0 || outs.length === 0) return { ok: false, reason: "need_both_answers" };

  const inStock = stockRules("inStock", ins, outs);
  const outOfStock = stockRules("outOfStock", outs, ins);
  const checks = pageChecks([...ins, ...outs], new Set([...inStock.qualifying, ...outOfStock.qualifying]));
  const suggestions = [...checks, ...inStock.list, ...outOfStock.list];

  const ticked = (kind: SuggestionKind) => suggestions.filter((s) => s.kind === kind && s.checked).map((s) => s.rule);
  const recipe: Recipe = { pageChecks: ticked("pageCheck"), inStock: ticked("inStock"), outOfStock: ticked("outOfStock") };
  return { ok: true, suggestions, passes: allPass(runExamples(examples, recipe), recipe) };
}
