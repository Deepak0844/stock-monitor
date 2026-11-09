import type { Recipe, StockRule } from "./types.js";

export type RecipeCheck = { ok: true; recipe: Recipe } | { ok: false; message: string };

const MAX_RULES = 10;
const MAX_WORDS = 200;

/** Lower case, with any run of spaces (including non-breaking ones) as one space. How every rule compares words. */
export const normaliseWords = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/[\s ]+/g, " ").trim();

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (message: string): never => {
  throw new Error(message);
};

function words(value: unknown, what: string): string {
  if (typeof value !== "string") return fail(`Enter the ${what} as words.`);
  const text = value.trim();
  if (!text) return fail(`Enter the ${what} as words.`);
  if (text.length > MAX_WORDS) return fail(`The ${what} can be at most ${MAX_WORDS} characters.`);
  return text;
}

/** Only the named keys are allowed, so nothing else can ride along. */
function only(input: Record<string, unknown>, allowed: string[], where: string): void {
  const extra = Object.keys(input).find((k) => !allowed.includes(k));
  if (extra !== undefined) fail(`"${extra}" is not allowed in ${where}.`);
}

function rule(input: unknown, list: string): StockRule {
  if (!isObject(input)) return fail(`Each rule in ${list} must be a rule.`);
  if (input.type === "text") {
    only(input, ["type", "text", "under"], "a text rule");
    return { type: "text", text: words(input.text, "words to look for"), ...(input.under === undefined ? {} : { under: words(input.under, "heading") }) };
  }
  if (input.type === "button") {
    only(input, ["type", "label", "enabled", "under"], "a button rule");
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") return fail("A button rule's enabled setting must be yes or no.");
    return {
      type: "button",
      label: words(input.label, "button label"),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.under === undefined ? {} : { under: words(input.under, "heading") }),
    };
  }
  return fail(`Rules in ${list} must be a text rule or a button rule. That rule type is not known.`);
}

function ruleList(input: unknown, list: string): StockRule[] {
  if (!Array.isArray(input)) return fail(`${list} must be a list of rules.`);
  if (input.length > MAX_RULES) return fail(`${list} can have at most ${MAX_RULES} rules.`);
  return input.map((r) => rule(r, list));
}

/** Checks a recipe the owner built and returns it cleaned, or one plain message about what to fix. */
export function validateRecipe(input: unknown): RecipeCheck {
  try {
    if (!isObject(input)) return fail("A recipe is a set of rules. Check the rules and try again.");
    only(input, ["pageChecks", "inStock", "outOfStock", "quantity", "region"], "a recipe");
    const pageChecks = ruleList(input.pageChecks, "Page checks");
    if (pageChecks.length === 0) return fail("Add at least one page check, so the app can tell when the page changes.");
    const recipe: Recipe = { pageChecks, inStock: ruleList(input.inStock, "In-stock rules"), outOfStock: ruleList(input.outOfStock, "Out-of-stock rules") };
    if (input.quantity !== undefined) {
      if (!isObject(input.quantity)) return fail("The quantity rule needs a label.");
      only(input.quantity, ["label", "under"], "the quantity rule");
      if (input.quantity.label === undefined) return fail("The quantity rule needs a label.");
      recipe.quantity = { label: words(input.quantity.label, "quantity label"), ...(input.quantity.under === undefined ? {} : { under: words(input.quantity.under, "heading") }) };
    }
    if (input.region !== undefined) {
      if (!isObject(input.region)) return fail("The region rule needs the heading of the region table.");
      only(input.region, ["under"], "the region rule");
      if (input.region.under === undefined) return fail("The region rule needs the heading of the region table.");
      recipe.region = { under: words(input.region.under, "region table heading") };
    }
    return { ok: true, recipe };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Check the rules and try again." };
  }
}
