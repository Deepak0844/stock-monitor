import type { Recipe, StockRule } from "../api.js";

export type RuleDraft = { type: "text" | "button"; words: string; enabled: "" | "true" | "false"; under: string };
export type Draft = {
  pageChecks: RuleDraft[];
  inStock: RuleDraft[];
  outOfStock: RuleDraft[];
  quantity: { on: boolean; label: string; under: string };
  region: { on: boolean; under: string };
};
type ListKey = "pageChecks" | "inStock" | "outOfStock";

export const emptyRule = (): RuleDraft => ({ type: "text", words: "", enabled: "", under: "" });
export const emptyDraft = (): Draft => ({ pageChecks: [emptyRule()], inStock: [], outOfStock: [], quantity: { on: false, label: "", under: "" }, region: { on: false, under: "" } });

const fromRule = (r: StockRule): RuleDraft =>
  r.type === "text"
    ? { type: "text", words: r.text, enabled: "", under: r.under ?? "" }
    : { type: "button", words: r.label, enabled: r.enabled === undefined ? "" : r.enabled ? "true" : "false", under: r.under ?? "" };

export function toDraft(recipe: Recipe): Draft {
  return {
    pageChecks: recipe.pageChecks.map(fromRule),
    inStock: recipe.inStock.map(fromRule),
    outOfStock: recipe.outOfStock.map(fromRule),
    quantity: { on: !!recipe.quantity, label: recipe.quantity?.label ?? "", under: recipe.quantity?.under ?? "" },
    region: { on: !!recipe.region, under: recipe.region?.under ?? "" },
  };
}

const toRule = (r: RuleDraft): StockRule | null => {
  const words = r.words.trim();
  if (!words) return null;
  const under = r.under.trim();
  return r.type === "text"
    ? { type: "text", text: words, ...(under ? { under } : {}) }
    : { type: "button", label: words, ...(r.enabled === "" ? {} : { enabled: r.enabled === "true" }), ...(under ? { under } : {}) };
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
    ...(draft.quantity.on && quantityLabel ? { quantity: { label: quantityLabel, ...(quantityUnder ? { under: quantityUnder } : {}) } } : {}),
    ...(draft.region.on && regionUnder ? { region: { under: regionUnder } } : {}),
  };
}

const GROUPS: { key: ListKey; title: string; hint: string }[] = [
  { key: "pageChecks", title: "Page checks", hint: "Words that must be on a normal product page. If any is missing, the page has changed and the answer is Cannot tell." },
  { key: "inStock", title: "In stock when", hint: "Any one of these matching means in stock." },
  { key: "outOfStock", title: "Out of stock when", hint: "Any one of these matching means out of stock." },
];

export function RuleEditor({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const setRule = (key: ListKey, index: number, patch: Partial<RuleDraft>) => onChange({ ...draft, [key]: draft[key].map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  const remove = (key: ListKey, index: number) => onChange({ ...draft, [key]: draft[key].filter((_, i) => i !== index) });
  const add = (key: ListKey) => onChange({ ...draft, [key]: [...draft[key], emptyRule()] });

  return (
    <div className="rule-editor">
      {GROUPS.map(({ key, title, hint }) => (
        <fieldset key={key}>
          <legend>{title}</legend>
          <p className="hint">{hint}</p>
          {draft[key].map((rule, i) => {
            const label = `${title} rule ${i + 1}`;
            return (
              <div className="rule-row" key={i} role="group" aria-label={label}>
                <div className="field">
                  <label htmlFor={`${key}-${i}-type`}>{`${label} type`}</label>
                  <select id={`${key}-${i}-type`} value={rule.type} onChange={(e) => setRule(key, i, { type: e.target.value as RuleDraft["type"] })}>
                    <option value="text">Text on the page</option>
                    <option value="button">Button on the page</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${key}-${i}-words`}>{`${label} words`}</label>
                  <input id={`${key}-${i}-words`} type="text" autoComplete="off" value={rule.words} onChange={(e) => setRule(key, i, { words: e.target.value })} />
                </div>
                {rule.type === "button" && (
                  <div className="field">
                    <label htmlFor={`${key}-${i}-enabled`}>{`${label} button must be`}</label>
                    <select id={`${key}-${i}-enabled`} value={rule.enabled} onChange={(e) => setRule(key, i, { enabled: e.target.value as RuleDraft["enabled"] })}>
                      <option value="">Either</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                )}
                <div className="field">
                  <label htmlFor={`${key}-${i}-under`}>{`${label} only under this heading (optional)`}</label>
                  <input id={`${key}-${i}-under`} type="text" autoComplete="off" value={rule.under} onChange={(e) => setRule(key, i, { under: e.target.value })} />
                </div>
                <button type="button" className="button secondary" aria-label={`Remove ${label}`} onClick={() => remove(key, i)}>
                  Remove
                </button>
              </div>
            );
          })}
          <button type="button" className="button secondary" onClick={() => add(key)}>
            {`Add a rule to ${title}`}
          </button>
        </fieldset>
      ))}

      <fieldset>
        <legend>Quantity (optional)</legend>
        <label className="check">
          <input type="checkbox" checked={draft.quantity.on} onChange={(e) => onChange({ ...draft, quantity: { ...draft.quantity, on: e.target.checked } })} />
          Read a quantity
        </label>
        {draft.quantity.on && (
          <>
            <div className="field">
              <label htmlFor="quantity-label">Quantity label</label>
              <input id="quantity-label" type="text" autoComplete="off" value={draft.quantity.label} onChange={(e) => onChange({ ...draft, quantity: { ...draft.quantity, label: e.target.value } })} />
              <p className="hint">The number right after these words is the quantity, for example "Units left".</p>
            </div>
            <div className="field">
              <label htmlFor="quantity-under">Quantity only under this heading (optional)</label>
              <input id="quantity-under" type="text" autoComplete="off" value={draft.quantity.under} onChange={(e) => onChange({ ...draft, quantity: { ...draft.quantity, under: e.target.value } })} />
            </div>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Region (optional)</legend>
        <label className="check">
          <input type="checkbox" checked={draft.region.on} onChange={(e) => onChange({ ...draft, region: { ...draft.region, on: e.target.checked } })} />
          This supplier lists stock by region
        </label>
        {draft.region.on && (
          <div className="field">
            <label htmlFor="region-under">Region table heading</label>
            <input id="region-under" type="text" autoComplete="off" value={draft.region.under} onChange={(e) => onChange({ ...draft, region: { ...draft.region, under: e.target.value } })} />
            <p className="hint">The heading above the list of regions and numbers. Choose the region itself on the supplier's page, or on each link.</p>
          </div>
        )}
      </fieldset>
    </div>
  );
}
