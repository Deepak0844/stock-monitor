import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import type { SuggestResult, Suggestion, SuggestionKind } from "../api.js";
import { Notice } from "./Notice.js";
import { ruleInWords } from "./ruleWords.js";
import { evidenceWords } from "./suggestedRules.js";

const GROUPS: { kind: SuggestionKind; title: string }[] = [
  { kind: "pageCheck", title: "Page checks" },
  { kind: "inStock", title: "In stock when" },
  { kind: "outOfStock", title: "Out of stock when" },
];

type Props = { result: SuggestResult; onAdd: (picked: Suggestion[]) => void; onClose: () => void };

/** Rules proposed from the labelled saved pages, each with where it was seen. The owner ticks, then adds them to the editor. */
export function RuleSuggestions({ result, onAdd, onClose }: Props) {
  const suggestions = result.ok ? result.suggestions : [];
  const [ticked, setTicked] = useState(() => new Set(suggestions.flatMap((s, i) => (s.checked ? [i] : []))));
  const toggle = (i: number) => setTicked((t) => (t.has(i) ? new Set([...t].filter((x) => x !== i)) : new Set(t).add(i)));

  if (!result.ok) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice kind="info">Label one saved page in stock and one out of stock, then try again.</Notice>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice kind="info">No rule stood out. Label more saved pages, or write the rules by hand below.</Notice>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4">
      <h3 className="text-base font-semibold">Suggested rules</h3>
      <Notice kind={result.passes ? "success" : "warning"}>{result.passes ? "These rules pass all your examples." : "These rules do not pass all your examples. Review before adding."}</Notice>
      {GROUPS.map(({ kind, title }) => {
        const rows = suggestions.flatMap((s, i) => (s.kind === kind ? [{ s, i }] : []));
        if (rows.length === 0) return null;
        return (
          <div key={kind} role="group" aria-label={title} className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{title}</p>
            {rows.map(({ s, i }) => (
              <label key={i} className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={ticked.has(i)} onChange={() => toggle(i)} />
                <span>
                  <span className="block font-medium">{ruleInWords(s.rule)}</span>
                  <span className="block text-muted-foreground">{evidenceWords(s)}</span>
                </span>
              </label>
            ))}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={ticked.size === 0} onClick={() => onAdd(suggestions.filter((_, i) => ticked.has(i)))}>
          Add ticked rules
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
