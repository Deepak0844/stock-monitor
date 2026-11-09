import { useState, type ChangeEvent } from "react";
import type { Api, ImportColumnChoice, ImportColumns, ImportPreview, ImportResult } from "../api.js";
import { Notice } from "../components/Notice.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

type Step =
  | { kind: "choose" }
  | { kind: "columns"; columns: ImportColumns; choice: Partial<Record<keyof ImportColumnChoice, number>> }
  | { kind: "preview"; columns: ImportColumns; choice: ImportColumnChoice; preview: ImportPreview }
  | { kind: "done"; result: ImportResult };

const COLUMN_FIELDS: { key: keyof ImportColumnChoice; label: string; hint: string }[] = [
  { key: "sku", label: "SKU column", hint: "Usually “Variant SKU”." },
  { key: "supplier", label: "Supplier name column", hint: "The column that holds the supplier's name." },
  { key: "address", label: "Page address column", hint: "The column that holds the supplier page address." },
  { key: "handle", label: "Product handle column", hint: "Usually “Handle”. It lets a product's supplier and address carry down to its other variants." },
];
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ImportMappingsPage({ api }: { api: Api }) {
  useTitle("Import links");
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const readFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void run(async () => {
      const content = await file.text();
      const columns = await api.mappings.importColumns(content);
      setText(content);
      const choice = Object.fromEntries(Object.entries(columns.suggested).filter(([, v]) => v !== null)) as Partial<Record<keyof ImportColumnChoice, number>>;
      setStep({ kind: "columns", columns, choice });
    });
  };

  const showPreview = (columns: ImportColumns, choice: ImportColumnChoice) =>
    run(async () => setStep({ kind: "preview", columns, choice, preview: await api.mappings.importPreview(text, choice) }));
  const confirm = (previewId: string) => run(async () => setStep({ kind: "done", result: await api.mappings.importConfirm(previewId) }));

  return (
    <>
      <div className="page-header">
        <h1>Import links</h1>
        <p className="muted">Upload the file from Shopify's Products &gt; Export. Nothing is saved until you have seen the preview and confirmed it.</p>
      </div>
      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}

      {step.kind !== "done" && (
        <section className="panel">
          <h2>1. Choose the file</h2>
          <div className="field">
            <label htmlFor="export-file">Shopify product export (CSV)</label>
            <input id="export-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={readFile} />
            <p className="hint">Up to 10 MB. The file is read here and sent to your own app. Descriptions and other columns are never stored.</p>
          </div>
        </section>
      )}

      {(step.kind === "columns" || step.kind === "preview") && (
        <ColumnsPanel
          columns={step.columns}
          initial={step.kind === "columns" ? step.choice : step.choice}
          busy={busy}
          onPreview={(choice) => void showPreview(step.columns, choice)}
        />
      )}

      {step.kind === "preview" && (
        <section className="panel" aria-labelledby="preview-heading">
          <h2 id="preview-heading">3. Preview</h2>
          {step.preview.goodCount > 0 ? (
            <>
              <p>
                <strong>{plural(step.preview.goodCount, "link")} {step.preview.goodCount === 1 ? "is" : "are"} ready to save</strong>
              </p>
              <p className="muted">
                {step.preview.counts.new} new, {step.preview.counts.replace} replaced, {step.preview.counts.unchanged} unchanged.
              </p>
            </>
          ) : (
            <Notice kind="warning">No rows can be saved. Check the columns above, or fix the problems below and import again.</Notice>
          )}
          {step.preview.skippedSuppliers > 0 && <p>
              {step.preview.skippedSuppliers} {step.preview.skippedSuppliers === 1 ? "row is" : "rows are"} for suppliers not in the app.
            </p>}
          {step.preview.sample.length > 0 && (
            <ul className="plain-list" aria-label="Examples">
              {step.preview.sample.map((s) => (
                <li key={s.line}>
                  {s.sku} → {s.url}
                </li>
              ))}
            </ul>
          )}
          {step.preview.problemCount > 0 && (
            <>
              <h3>{plural(step.preview.problemCount, "problem")}</h3>
              <ul className="plain-list">
                {step.preview.problems.map((p) => (
                  <li key={`${p.line}-${p.message}`}>
                    Line {p.line}: {p.message}
                  </li>
                ))}
              </ul>
              {step.preview.problemCount > step.preview.problems.length && <p className="muted">Showing the first {step.preview.problems.length}.</p>}
            </>
          )}
          {step.preview.warnings.length > 0 && (
            <>
              <h3>Worth a look</h3>
              <ul className="plain-list">
                {step.preview.warnings.map((w) => (
                  <li key={`${w.line}-${w.message}`}>
                    Line {w.line}: {w.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {step.preview.goodCount > 0 && (
            <div className="actions">
              <button type="button" className="button primary" disabled={busy} onClick={() => void confirm(step.preview.previewId)}>
                Save {plural(step.preview.goodCount, "link")}
              </button>
              <Link to="/mappings" className="button secondary">
                Cancel
              </Link>
            </div>
          )}
        </section>
      )}

      {step.kind === "done" && (
        <section className="panel">
          <Notice kind="success" role="status">
            {plural(step.result.created, "new link")} saved, {step.result.updated} replaced, {step.result.unchanged} unchanged
            {step.result.skipped > 0 ? `, ${step.result.skipped} skipped because another supplier already has them` : ""}.
          </Notice>
          <p className="muted">To check these links, open the list, choose the supplier and select Check all links.</p>
          <div className="actions">
            <Link to="/mappings" className="button primary inline">
              Go to links
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

function ColumnsPanel({ columns, initial, busy, onPreview }: { columns: ImportColumns; initial: Partial<Record<keyof ImportColumnChoice, number>>; busy: boolean; onPreview: (c: ImportColumnChoice) => void }) {
  const [choice, setChoice] = useState(initial);
  const complete = COLUMN_FIELDS.every((f) => choice[f.key] !== undefined);
  return (
    <section className="panel">
      <h2>2. Check the columns</h2>
      <p className="muted">{columns.rowCount.toLocaleString("en")} rows found. These are our best guesses. Change any that are wrong.</p>
      {COLUMN_FIELDS.map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={`col-${f.key}`}>{f.label}</label>
          <select
            id={`col-${f.key}`}
            value={choice[f.key] === undefined ? "" : String(choice[f.key])}
            onChange={(e) => setChoice((c) => ({ ...c, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}
          >
            <option value="">Choose a column</option>
            {columns.header.map((name, i) => (
              <option key={i} value={i}>
                {name || `(column ${i + 1})`}
              </option>
            ))}
          </select>
          <p className="hint">{f.hint}</p>
        </div>
      ))}
      <div className="actions">
        <button type="button" className="button primary" disabled={busy || !complete} onClick={() => complete && onPreview(choice as ImportColumnChoice)}>
          Show preview
        </button>
      </div>
    </section>
  );
}
