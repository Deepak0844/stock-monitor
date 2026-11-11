import type { Recipe, StockRule } from "../api.js";

const rule = (r: StockRule): string => {
  const under = r.under ? ` under “${r.under}”` : "";
  if (r.type === "text") return `Text: “${r.text}”${under}`;
  const state = r.enabled === undefined ? "" : r.enabled ? " (must be enabled)" : " (must be disabled)";
  return `Button: “${r.label}”${state}${under}`;
};

/** A version's rules in plain words, by group. A group with nothing in it is left out. */
export function ruleLines(recipe: Recipe): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (recipe.pageChecks.length) out["Page checks"] = recipe.pageChecks.map(rule);
  if (recipe.inStock.length) out["In stock when"] = recipe.inStock.map(rule);
  if (recipe.outOfStock.length) out["Out of stock when"] = recipe.outOfStock.map(rule);
  if (recipe.quantity) out.Quantity = [`Number after “${recipe.quantity.label}”${recipe.quantity.under ? ` under “${recipe.quantity.under}”` : ""}`];
  if (recipe.region) out.Region = [`Regions listed under “${recipe.region.under}”`];
  return out;
}

const flat = (recipe: Recipe) => Object.entries(ruleLines(recipe)).flatMap(([group, lines]) => lines.map((l) => `${group}: ${l}`));

/** What `of` has that `base` does not (added), and what `base` has that `of` does not (removed). */
export function diffRules(of: Recipe, base: Recipe): { added: string[]; removed: string[] } {
  const a = flat(of);
  const b = flat(base);
  return { added: a.filter((x) => !b.includes(x)), removed: b.filter((x) => !a.includes(x)) };
}
