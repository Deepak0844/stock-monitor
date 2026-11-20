import { X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input, Select } from "@/components/ui/input.js";
import type { Recipe, StockRule, Waiting } from "../api.js";
import { Field } from "./Field.js";
import { WAITING_WORDS } from "./ruleWords.js";

export type RuleDraft = {
  type: "text" | "button";
  words: string;
  enabled: "" | "true" | "false";
  under: string;
};
export type Draft = {
  pageChecks: RuleDraft[];
  inStock: RuleDraft[];
  outOfStock: RuleDraft[];
  quantity: { on: boolean; label: string; under: string };
  region: { on: boolean; under: string };
  /** The page's built-in stock data answers first; the word rules only when it is missing or unclear. */
  builtIn: { on: boolean; waiting: Waiting };
};
type ListKey = "pageChecks" | "inStock" | "outOfStock";

export const emptyRule = (): RuleDraft => ({ type: "text", words: "", enabled: "", under: "" });
/** A new supplier's first rules use built-in data: most suppliers' pages have it. */
export const emptyDraft = (): Draft => ({
  pageChecks: [emptyRule()],
  inStock: [],
  outOfStock: [],
  quantity: { on: false, label: "", under: "" },
  region: { on: false, under: "" },
  builtIn: { on: true, waiting: "out_of_stock" },
});

export const fromRule = (r: StockRule): RuleDraft =>
  r.type === "text"
    ? { type: "text", words: r.text, enabled: "", under: r.under ?? "" }
    : {
        type: "button",
        words: r.label,
        enabled: r.enabled === undefined ? "" : r.enabled ? "true" : "false",
        under: r.under ?? "",
      };

export function toDraft(recipe: Recipe): Draft {
  return {
    pageChecks: recipe.pageChecks.map(fromRule),
    inStock: recipe.inStock.map(fromRule),
    outOfStock: recipe.outOfStock.map(fromRule),
    quantity: {
      on: !!recipe.quantity,
      label: recipe.quantity?.label ?? "",
      under: recipe.quantity?.under ?? "",
    },
    region: { on: !!recipe.region, under: recipe.region?.under ?? "" },
    // A version saved without built-in data opens with it off, as it was saved.
    builtIn: { on: !!recipe.builtIn, waiting: recipe.builtIn?.waiting ?? "out_of_stock" },
  };
}

const toRule = (r: RuleDraft): StockRule | null => {
  const words = r.words.trim();
  if (!words) return null;
  const under = r.under.trim();
  return r.type === "text"
    ? { type: "text", text: words, ...(under ? { under } : {}) }
    : {
        type: "button",
        label: words,
        ...(r.enabled === "" ? {} : { enabled: r.enabled === "true" }),
        ...(under ? { under } : {}),
      };
};

/** The recipe the owner built. Rows left empty are dropped. The server checks the rest and says what to fix. */
export function toRecipe(draft: Draft): Recipe {
  const list = (rows: RuleDraft[]) => rows.map(toRule).filter((r): r is StockRule => r !== null);
  const quantityLabel = draft.quantity.label.trim();
  const quantityUnder = draft.quantity.under.trim();
  const regionUnder = draft.region.under.trim();
  return {
    pageChecks: list(draft.pageChecks),
    inStock: list(draft.inStock),
    outOfStock: list(draft.outOfStock),
    ...(draft.quantity.on && quantityLabel
      ? { quantity: { label: quantityLabel, ...(quantityUnder ? { under: quantityUnder } : {}) } }
      : {}),
    ...(draft.region.on && regionUnder ? { region: { under: regionUnder } } : {}),
    ...(draft.builtIn.on ? { builtIn: { waiting: draft.builtIn.waiting } } : {}),
  };
}

const GROUPS: { key: ListKey; title: string; hint: string }[] = [
  {
    key: "pageChecks",
    title: "Page checks",
    hint: "Words that must be on a normal product page. If any is missing, the page has changed and the answer is Cannot tell.",
  },
  { key: "inStock", title: "In stock when", hint: "Any one of these matching means in stock." },
  {
    key: "outOfStock",
    title: "Out of stock when",
    hint: "Any one of these matching means out of stock.",
  },
];

const legend = "mb-1 text-base font-semibold";
const checkbox = "flex items-center gap-2 text-sm font-medium";

export function RuleEditor({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  const setRule = (key: ListKey, index: number, patch: Partial<RuleDraft>) =>
    onChange({ ...draft, [key]: draft[key].map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  const remove = (key: ListKey, index: number) =>
    onChange({ ...draft, [key]: draft[key].filter((_, i) => i !== index) });
  const add = (key: ListKey) => onChange({ ...draft, [key]: [...draft[key], emptyRule()] });

  const builtIn = draft.builtIn.on;
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className={legend}>Built-in stock data</legend>
        <p id="built-in-hint" className="text-sm text-muted-foreground">
          Most shops put stock in data built into their pages, for search engines. In stock and
          limited stock count as in stock; out of stock, sold out and discontinued count as out of
          stock.
        </p>
        <label className={`${checkbox} min-h-11`}>
          <input
            type="checkbox"
            role="switch"
            aria-describedby="built-in-hint"
            className="size-5 accent-primary"
            checked={builtIn}
            onChange={(e) =>
              onChange({ ...draft, builtIn: { ...draft.builtIn, on: e.target.checked } })
            }
          />
          Use the stock data built into the supplier's pages
        </label>
        {builtIn && (
          <Field id="built-in-waiting" label="Pre-order and back-order count as">
            <Select
              id="built-in-waiting"
              className="w-full sm:w-64"
              value={draft.builtIn.waiting}
              onChange={(e) =>
                onChange({
                  ...draft,
                  builtIn: { ...draft.builtIn, waiting: e.target.value as Waiting },
                })
              }
            >
              {(Object.keys(WAITING_WORDS) as Waiting[]).map((w) => (
                <option key={w} value={w}>
                  {WAITING_WORDS[w]}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </fieldset>

      {builtIn && (
        <h3 className="-mb-3 text-base font-semibold text-muted-foreground">
          If the built-in data is missing or unclear
        </h3>
      )}
      {GROUPS.map(({ key, title, hint }) => (
        <fieldset key={key} className="flex flex-col gap-3">
          <legend className={legend}>{title}</legend>
          <p className="text-sm text-muted-foreground">
            {hint}
            {builtIn && key === "pageChecks"
              ? " Page checks are optional while built-in data is on."
              : ""}
          </p>
          {draft[key].map((rule, i) => {
            const label = `${title} rule ${i + 1}`;
            return (
              // One line that reads as a sentence: [Text on the page] says [Sold out] under [heading]. Labels stay for screen readers.
              <div
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 [&_label]:sr-only [&>div]:gap-0"
                key={i}
                role="group"
                aria-label={label}
              >
                <Field id={`${key}-${i}-type`} label={`${label} type`}>
                  <Select
                    id={`${key}-${i}-type`}
                    className="w-48"
                    value={rule.type}
                    onChange={(e) => setRule(key, i, { type: e.target.value as RuleDraft["type"] })}
                  >
                    <option value="text">Text on the page</option>
                    <option value="button">Button on the page</option>
                  </Select>
                </Field>
                <span aria-hidden="true" className="text-sm text-muted-foreground">
                  {rule.type === "button" ? "labelled" : "says"}
                </span>
                <Field id={`${key}-${i}-words`} label={`${label} words`}>
                  <Input
                    id={`${key}-${i}-words`}
                    type="text"
                    autoComplete="off"
                    className="w-44"
                    placeholder="Words"
                    value={rule.words}
                    onChange={(e) => setRule(key, i, { words: e.target.value })}
                  />
                </Field>
                {rule.type === "button" && (
                  <>
                    <span aria-hidden="true" className="text-sm text-muted-foreground">
                      is
                    </span>
                    <Field id={`${key}-${i}-enabled`} label={`${label} button must be`}>
                      <Select
                        id={`${key}-${i}-enabled`}
                        className="w-32"
                        value={rule.enabled}
                        onChange={(e) =>
                          setRule(key, i, { enabled: e.target.value as RuleDraft["enabled"] })
                        }
                      >
                        <option value="">Either</option>
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </Select>
                    </Field>
                  </>
                )}
                <span aria-hidden="true" className="text-sm text-muted-foreground">
                  under
                </span>
                <Field
                  id={`${key}-${i}-under`}
                  label={`${label} only under this heading (optional)`}
                >
                  <Input
                    id={`${key}-${i}-under`}
                    type="text"
                    autoComplete="off"
                    className="w-44"
                    placeholder="Any heading"
                    value={rule.under}
                    onChange={(e) => setRule(key, i, { under: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto text-muted-foreground"
                  aria-label={`Remove ${label}`}
                  onClick={() => remove(key, i)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            );
          })}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => add(key)}>
              {`Add a rule to ${title}`}
            </Button>
          </div>
        </fieldset>
      ))}

      <fieldset className="flex flex-col gap-3">
        <legend className={legend}>Quantity (optional)</legend>
        <label className={checkbox}>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={draft.quantity.on}
            onChange={(e) =>
              onChange({ ...draft, quantity: { ...draft.quantity, on: e.target.checked } })
            }
          />
          Read a quantity
        </label>
        {draft.quantity.on && (
          <>
            <Field
              id="quantity-label"
              label="Quantity label"
              hint='The number right after these words is the quantity, for example "Units left".'
            >
              <Input
                id="quantity-label"
                type="text"
                autoComplete="off"
                value={draft.quantity.label}
                onChange={(e) =>
                  onChange({ ...draft, quantity: { ...draft.quantity, label: e.target.value } })
                }
              />
            </Field>
            <Field id="quantity-under" label="Quantity only under this heading (optional)">
              <Input
                id="quantity-under"
                type="text"
                autoComplete="off"
                value={draft.quantity.under}
                onChange={(e) =>
                  onChange({ ...draft, quantity: { ...draft.quantity, under: e.target.value } })
                }
              />
            </Field>
          </>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className={legend}>Region (optional)</legend>
        <label className={checkbox}>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={draft.region.on}
            onChange={(e) =>
              onChange({ ...draft, region: { ...draft.region, on: e.target.checked } })
            }
          />
          This supplier lists stock by region
        </label>
        {draft.region.on && (
          <Field
            id="region-under"
            label="Region table heading"
            hint="The heading above the list of regions and numbers. Choose the region itself on the supplier's page, or on each link."
          >
            <Input
              id="region-under"
              type="text"
              autoComplete="off"
              value={draft.region.under}
              onChange={(e) =>
                onChange({ ...draft, region: { ...draft.region, under: e.target.value } })
              }
            />
          </Field>
        )}
      </fieldset>
    </div>
  );
}
