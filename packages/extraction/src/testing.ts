import { decide, NO_LINK } from "./decide.js";
import type { LinkRef } from "./built-in.js";
import type { Answer, Decision, PageDescription, Reason, Recipe } from "./types.js";

/** `link` is the saved page's link (address and supplier option), for pages that list several options. Left out: no link. */
export type Example = { id: string; name: string; expected: Answer; page: PageDescription; region: string | null; link?: LinkRef };
export type ExampleResult = { id: string; name: string; expected: Answer; got: Decision; passed: boolean };

/** Runs a recipe on the owner's labelled captures. The same `decide` as a real check, so a pass here means the same there. */
export function runExamples(examples: Example[], recipe: Recipe): ExampleResult[] {
  return examples.map((e) => {
    const got = decide(e.page, recipe, e.region, e.link ?? NO_LINK);
    return { id: e.id, name: e.name, expected: e.expected, got, passed: got.answer === e.expected };
  });
}

/** At least one example expects in stock and one expects out of stock. */
export const hasBothAnswers = (results: ExampleResult[]): boolean => results.some((r) => r.expected === "in_stock") && results.some((r) => r.expected === "out_of_stock");

/**
 * A recipe may only be turned on when every example passed, and there is at least one. With built-in data on, there must be
 * an in-stock and an out-of-stock example too, so data that never changes cannot pass.
 */
export const allPass = (results: ExampleResult[], recipe: Recipe): boolean => results.length > 0 && results.every((r) => r.passed) && (!recipe.builtIn || hasBothAnswers(results));

const WIDE_MIN_LINKS = 5;
const WIDE_SHARE = 0.3;
/** True when a whole run looks like the supplier changed its pages: at least 5 links and at least 30% "page changed". */
export function isSupplierWideChange(reasons: (Reason | null)[]): boolean {
  const changed = reasons.filter((r) => r === "page_changed").length;
  return reasons.length >= WIDE_MIN_LINKS && changed / reasons.length >= WIDE_SHARE;
}
