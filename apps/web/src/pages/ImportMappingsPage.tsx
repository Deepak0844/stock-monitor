import { useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Select } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, ImportColumnChoice, ImportColumns, ImportPreview, ImportResult } from "../api.js";
import { Field } from "../components/Field.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
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

  const heading = "mb-3 text-base font-semibold";
  const list = "flex flex-col gap-1 text-sm";
  return (
    <>
      <PageHeader title="Import links" description="Upload the file from Shopify's Products > Export. Nothing is saved until you have seen the preview and confirmed it." />
      <div className="flex max-w-3xl flex-col gap-6">
        {error && (
          <Notice kind="error" role="alert">
            {error}
          </Notice>
        )}

        {step.kind !== "done" && (
          <Card className="p-6">
            <h2 className={heading}>1. Choose the file</h2>
            <Field id="export-file" label="Shopify product export (CSV)" hint="Up to 10 MB. The file is read here and sent to your own app. Descriptions and other columns are never stored.">
              <input
                id="export-file"
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={readFile}
                className="text-sm file:mr-3 file:h-10 file:cursor-pointer file:rounded-lg file:border file:border-input file:bg-card file:px-4 file:text-sm file:font-semibold"
              />
            </Field>
            {busy && step.kind === "choose" && (
              <div className="mt-4 flex flex-col gap-2">
                <p role="status" className="text-sm font-medium">
                  Reading the file…
                </p>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
          </Card>
        )}

        {(step.kind === "columns" || step.kind === "preview") && (
          <ColumnsPanel columns={step.columns} initial={step.choice} busy={busy} onPreview={(choice) => void showPreview(step.columns, choice)} />
        )}

        {step.kind === "preview" && (
          <Card className="flex flex-col gap-3 p-6" aria-labelledby="preview-heading" role="region">
            <h2 id="preview-heading" className={heading}>
              3. Preview
            </h2>
            {step.preview.goodCount > 0 ? (
              <>
                <p>
                  <strong>
                    {plural(step.preview.goodCount, "link")} {step.preview.goodCount === 1 ? "is" : "are"} ready to save
                  </strong>
                </p>
                <p className="text-sm text-muted-foreground">
                  {step.preview.counts.new} new, {step.preview.counts.replace} replaced, {step.preview.counts.unchanged} unchanged.
                </p>
              </>
            ) : (
              <Notice kind="warning">No rows can be saved. Check the columns above, or fix the problems below and import again.</Notice>
            )}
            {step.preview.skippedSuppliers > 0 && (
              <p className="text-sm">
                {step.preview.skippedSuppliers} {step.preview.skippedSuppliers === 1 ? "row is" : "rows are"} for suppliers not in the app.
              </p>
            )}
            {step.preview.skippedShopify > 0 && (
              <p className="text-sm">
                {step.preview.skippedShopify} {step.preview.skippedShopify === 1 ? "row is" : "rows are"} left out because Shopify already has the supplier and page address for {step.preview.skippedShopify === 1 ? "that product" : "those products"}.
              </p>
            )}
            {step.preview.sample.length > 0 && (
              <ul className={list} aria-label="Examples">
                {step.preview.sample.map((s) => (
                  <li key={s.line} className="break-all">
                    {s.sku} → {s.url}
                  </li>
                ))}
              </ul>
            )}
            {step.preview.problemCount > 0 && (
              <>
                <h3 className="text-sm font-semibold">{plural(step.preview.problemCount, "problem")}</h3>
                <ul className={list}>
                  {step.preview.problems.map((p) => (
                    <li key={`${p.line}-${p.message}`}>
                      Line {p.line}: {p.message}
                    </li>
                  ))}
                </ul>
                {step.preview.problemCount > step.preview.problems.length && <p className="text-sm text-muted-foreground">Showing the first {step.preview.problems.length}.</p>}
              </>
            )}
            {step.preview.warnings.length > 0 && (
              <>
                <h3 className="text-sm font-semibold">Worth a look</h3>
                <ul className={list}>
                  {step.preview.warnings.map((w) => (
                    <li key={`${w.line}-${w.message}`}>
                      Line {w.line}: {w.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {step.preview.goodCount > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button loading={busy} onClick={() => void confirm(step.preview.previewId)}>
                  Save {plural(step.preview.goodCount, "link")}
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/mappings">Cancel</Link>
                </Button>
              </div>
            )}
          </Card>
        )}

        {step.kind === "done" && (
          <Card className="flex flex-col gap-3 p-6">
            <Notice kind="success" role="status">
              {plural(step.result.created, "new link")} saved, {step.result.updated} replaced, {step.result.unchanged} unchanged
              {step.result.skipped > 0 ? `, ${step.result.skipped} skipped because another supplier already has them` : ""}.
            </Notice>
            <p className="text-sm text-muted-foreground">To check these links, open the list, choose the supplier and select Check all links.</p>
            <div>
              <Button asChild>
                <Link to="/mappings">Go to links</Link>
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function ColumnsPanel({ columns, initial, busy, onPreview }: { columns: ImportColumns; initial: Partial<Record<keyof ImportColumnChoice, number>>; busy: boolean; onPreview: (c: ImportColumnChoice) => void }) {
  const [choice, setChoice] = useState(initial);
  const complete = COLUMN_FIELDS.every((f) => choice[f.key] !== undefined);
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">2. Check the columns</h2>
      <p className="text-sm text-muted-foreground">{columns.rowCount.toLocaleString("en-GB")} rows found. These are our best guesses. Change any that are wrong.</p>
      {COLUMN_FIELDS.map((f) => (
        <Field id={`col-${f.key}`} label={f.label} hint={f.hint} key={f.key}>
          <Select
            id={`col-${f.key}`}
            className="w-full"
            value={choice[f.key] === undefined ? "" : String(choice[f.key])}
            onChange={(e) => setChoice((c) => ({ ...c, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}
          >
            <option value="">Choose a column</option>
            {columns.header.map((name, i) => (
              <option key={i} value={i}>
                {name || `(column ${i + 1})`}
              </option>
            ))}
          </Select>
        </Field>
      ))}
      <div>
        <Button loading={busy} disabled={!complete} onClick={() => complete && onPreview(choice as ImportColumnChoice)}>
          Show preview
        </Button>
      </div>
    </Card>
  );
}
