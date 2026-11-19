import type { StockRule, Suggestion, SuggestionKind } from "../api.js";
import { fromRule, type Draft, type RuleDraft } from "./RuleEditor.js";

const LIST: Record<SuggestionKind, "pageChecks" | "inStock" | "outOfStock"> = { pageCheck: "pageChecks", inStock: "inStock", outOfStock: "outOfStock" };

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const same = (r: RuleDraft) => `${r.type}|${squash(r.words)}|${r.enabled}`;
const sameRule = (rule: StockRule) => same(fromRule(rule));

/** Adds the picked rules to the right lists. A rule already there is skipped, and an empty row gives way to the first rule added. */
export function addSuggested(draft: Draft, picked: Suggestion[]): Draft {
  const next: Draft = { ...draft };
  for (const kind of Object.keys(LIST) as SuggestionKind[]) {
    const wanted = picked.filter((p) => p.kind === kind);
    if (wanted.length === 0) continue;
    const list = LIST[kind];
    const kept = next[list].filter((r) => r.words.trim() !== "");
    const have = new Set(kept.map(same));
    const added = wanted.filter((p) => !have.has(sameRule(p.rule)) && have.add(sameRule(p.rule))).map((p) => fromRule(p.rule));
    next[list] = [...kept, ...added];
  }
  return next;
}

const pages = (n: number, word: string) => `${n} ${word} ${n === 1 ? "page" : "pages"}`;

/** Where a suggested rule was seen, in plain words. */
export function evidenceWords(s: Suggestion): string {
  if (s.kind === "pageCheck") return `On all ${pages(s.ofTotal, "labelled")}.`;
  const [own, other] = s.kind === "outOfStock" ? ["out of stock", "in stock"] : ["in stock", "out of stock"];
  return `On ${s.seenOn} of ${pages(s.ofTotal, own)} and ${s.seenOnOther} of ${pages(s.otherTotal, other)}.`;
}
