import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Input, Select } from "@/components/ui/input.js";
import type { Api, Capture, CaptureDetail, ExampleResult, Mapping, RecipeTest, RecipeVersion, StockAnswer, Supplier } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Field } from "../components/Field.js";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";
import { emptyDraft, RuleEditor, toDraft, toRecipe, type Draft } from "../components/RuleEditor.js";
import { Notice } from "../components/Notice.js";
import { ANSWER_WORDS, captureFailureWords, reasonWords } from "../components/stockWords.js";
import { formatWhen } from "../format.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const POLL_MS = 3000;
const POLLS = 20;
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function StockRulesPage({ api, supplierId }: { api: Api; supplierId: string }) {
  useTitle("Stock rules");
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [links, setLinks] = useState<Mapping[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [versions, setVersions] = useState<RecipeVersion[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<RecipeTest | null>(null);
  const [mappingId, setMappingId] = useState("");
  const [captureName, setCaptureName] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<CaptureDetail | null>(null);
  const [labelName, setLabelName] = useState("");
  const [labelExpected, setLabelExpected] = useState<StockAnswer | "">("");
  const [deleting, setDeleting] = useState<Capture | null>(null);
  const polls = useRef(0);

  const loadCaptures = useCallback(() => api.captures.list(supplierId).then(setCaptures).catch((e: unknown) => setError(message(e))), [api, supplierId]);
  const loadVersions = useCallback(() => api.recipes.list(supplierId).then(setVersions).catch((e: unknown) => setError(message(e))), [api, supplierId]);

  useEffect(() => {
    api.suppliers.get(supplierId).then(setSupplier).catch((e: unknown) => setLoadError(message(e)));
    api.mappings.list({ supplierId }).then(setLinks).catch(() => {});
    void loadCaptures();
    void loadVersions();
  }, [api, supplierId, loadCaptures, loadVersions]);

  // Start the editor from the rules that are on, else the newest version. Only the first time, so edits are never overwritten.
  useEffect(() => {
    if (started || versions.length === 0) return;
    setDraft(toDraft((versions.find((v) => v.active) ?? versions[0])!.rules));
    setStarted(true);
  }, [versions, started]);

  // A capture takes a moment. The list is read again shortly after, and never after the page is left.
  useEffect(() => {
    if (!captures.some((c) => c.status === "pending") || polls.current >= POLLS) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      void loadCaptures();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [captures, loadCaptures]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function requestCapture() {
    setCaptureError(null);
    setDone(null);
    if (!mappingId) return setCaptureError("Choose the link whose page you want to capture.");
    setBusy(true);
    try {
      const name = captureName.trim();
      await api.captures.request(supplierId, { mappingId, ...(name ? { name } : {}) });
      polls.current = 0;
      setCaptureName("");
      setDone("Capturing the page. It will appear in the list in a moment.");
      await loadCaptures();
    } catch (e) {
      setCaptureError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const view = (c: Capture) =>
    run(async () => {
      const detail = await api.captures.get(c.id);
      setViewing(detail);
      setLabelName(detail.name);
      setLabelExpected(detail.expectedAnswer ?? "");
    });
  const saveLabel = (c: CaptureDetail) =>
    run(async () => {
      await api.captures.label(c.id, { name: labelName.trim(), expected: labelExpected === "" ? null : labelExpected });
      setDone("Label saved.");
      setTest(null);
      await loadCaptures();
    });
  const removeCapture = async (c: Capture) => {
    await api.captures.remove(c.id);
    setCaptures((list) => list.filter((x) => x.id !== c.id));
    if (viewing?.id === c.id) setViewing(null);
    setTest(null);
    setDone("Deleted the saved page.");
  };
  const runTest = () =>
    run(async () => {
      setTest(await api.recipes.test(supplierId, toRecipe(draft)));
    });
  const save = () =>
    run(async () => {
      const saved = await api.recipes.save(supplierId, toRecipe(draft));
      setDone(`Saved as version ${saved.version}. It is not turned on yet.`);
      await loadVersions();
    });
  const turnOn = (v: RecipeVersion) =>
    run(async () => {
      await api.recipes.activate(v.id);
      setDone(`Version ${v.version} is turned on. Stock checks use it now.`);
      await loadVersions();
    });

  const labelled = captures.filter((c) => c.status === "ready" && c.expectedAnswer !== null).length;
  const turnOnBlock = labelled === 0 ? "Label at least one saved page with the answer you expect." : test && !test.passed ? "Some examples do not give the answer you expect. Fix the rules and test again." : null;
  const failing = test ? test.results.filter((r) => !r.passed).length : 0;

  if (loadError) {
    return (
      <>
        <PageHeader title="Stock rules" />
        <div className="flex max-w-2xl flex-col items-start gap-3">
          <Notice kind="error" role="alert">
            {loadError}
          </Notice>
          <Button variant="outline" asChild>
            <Link to="/suppliers">Back to suppliers</Link>
          </Button>
        </div>
      </>
    );
  }

  const resultLine = (r: ExampleResult) => (
    <li key={r.id}>
      <strong>{r.name}</strong>: {r.passed ? "Passed" : "Failed"}.
      {!r.passed && (
        <>
          {" "}You expected {ANSWER_WORDS[r.expected]}, the rules said {ANSWER_WORDS[r.got.answer]}. {reasonWords(r.got.reason) ?? ""}
        </>
      )}
    </li>
  );
  const list = "flex flex-col divide-y divide-border text-sm";
  const row = "flex flex-wrap items-center justify-between gap-3 py-3";

  return (
    <>
      <PageHeader
        title="Stock rules"
        description="Teach the app how this supplier's pages show stock. The app reads the words on the page, never the picture. When it cannot tell, it says so and never guesses out of stock."
      />
      <p className="-mt-3 mb-6 text-sm font-semibold">{supplier ? supplier.name : "Loading…"}</p>

      <div className="flex max-w-4xl flex-col gap-6">
        {error && (
          <Notice kind="error" role="alert">
            {error}
          </Notice>
        )}
        <div aria-live="polite">
          {done && (
            <Notice kind="success" role="status">
              {done}
            </Notice>
          )}
        </div>

        <Panel
          id="pages-heading"
          title="Saved pages"
          description="Capture a real product page, then label saved pages with the answer you expect. Your rules are tested on them before they can be turned on."
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Field id="capture-link" label="Link to capture">
                <Select id="capture-link" className="w-full" value={mappingId} onChange={(e) => setMappingId(e.target.value)}>
                  <option value="">Choose a link</option>
                  {links.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.productTitle} · {m.variantTitle}
                      {m.sku ? ` · ${m.sku}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="min-w-48 flex-1">
              <Field id="capture-name" label="Name (optional)">
                <Input id="capture-name" type="text" autoComplete="off" value={captureName} onChange={(e) => setCaptureName(e.target.value)} />
              </Field>
            </div>
            <Button disabled={busy} onClick={() => void requestCapture()}>
              Capture a page
            </Button>
          </div>
          {captureError && (
            <Notice kind="error" role="alert">
              {captureError}
            </Notice>
          )}

          {captures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved pages yet. Capture a page from one of this supplier's links to start.</p>
          ) : (
            <ul className={list} aria-label="Saved pages">
              {captures.map((c) => {
                const name = c.name || "Unnamed capture";
                return (
                  <li key={c.id} className={row}>
                    <span className="min-w-0">
                      <strong>{name}</strong>
                      <br />
                      <span className="text-muted-foreground">{c.status === "pending" ? "Capturing…" : c.status === "failed" ? `Could not capture. ${captureFailureWords(c.failureReason)}` : `Saved ${formatWhen(c.createdAt)}`}</span>
                      <span className="text-muted-foreground">
                        {c.expectedAnswer ? ` · Expected: ${ANSWER_WORDS[c.expectedAnswer]}` : " · Not labelled"}
                        {c.keptReason === "page_changed" ? " · Kept because the page changed" : ""}
                      </span>
                      {c.expectedAnswer && (
                        <>
                          <br />
                          <span className="text-muted-foreground">Contains a picture of the page. Delete it when you no longer need it.</span>
                        </>
                      )}
                    </span>
                    <span className="flex gap-2">
                      {c.status === "ready" && (
                        <Button variant="outline" size="sm" disabled={busy} aria-label={`View ${name}`} onClick={() => void view(c)}>
                          View
                        </Button>
                      )}
                      <Button variant="outline" size="sm" disabled={busy} aria-label={`Delete ${name}`} onClick={() => setDeleting(c)}>
                        Delete
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {viewing && (
          <Panel id="viewing-heading" title={`Saved page: ${viewing.name || "Unnamed capture"}`}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <Field id="label-name" label="Name">
                  <Input id="label-name" type="text" autoComplete="off" value={labelName} onChange={(e) => setLabelName(e.target.value)} />
                </Field>
              </div>
              <div className="min-w-48 flex-1">
                <Field id="label-expected" label="Answer you expect">
                  <Select id="label-expected" className="w-full" value={labelExpected} onChange={(e) => setLabelExpected(e.target.value as StockAnswer | "")}>
                    <option value="">Not labelled</option>
                    <option value="in_stock">In stock</option>
                    <option value="out_of_stock">Out of stock</option>
                    <option value="cannot_tell">Cannot tell</option>
                  </Select>
                </Field>
              </div>
              <Button variant="outline" disabled={busy} onClick={() => void saveLabel(viewing)}>
                Save label
              </Button>
            </div>
            {viewing.hasPicture && <img className="max-w-full rounded-lg border border-border" src={api.captures.pictureUrl(viewing.id)} alt="Picture of the saved page" />}
            {viewing.description && (
              <div className="flex flex-col gap-2 text-sm">
                <h3 className="font-semibold">What the page said</h3>
                {viewing.description.sections.map((s, i) => (
                  <div key={i}>
                    {s.heading !== null && <h4 className="font-medium">{s.heading}</h4>}
                    <ul className="flex flex-col gap-1 text-muted-foreground">
                      {s.lines.map((line, j) => (
                        <li key={j}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
                <h3 className="mt-2 font-semibold">Buttons</h3>
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {viewing.description.buttons.map((b, i) => (
                    <li key={i}>
                      {b.label} ({b.enabled ? "enabled" : "disabled"}
                      {b.section ? `, under ${b.section}` : ""})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        )}

        <Panel id="rules-heading" title="Rules">
          <RuleEditor
            draft={draft}
            onChange={(d) => {
              setDraft(d);
              setTest(null);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void runTest()}>
              Test all examples
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              Save version
            </Button>
          </div>
          {test && (
            <div className="flex flex-col gap-3" aria-live="polite">
              {test.results.length === 0 ? (
                <Notice kind="warning">There are no labelled saved pages to test yet. Label a saved page with the answer you expect.</Notice>
              ) : test.passed ? (
                <Notice kind="success">All examples give the answer you expect.</Notice>
              ) : (
                <Notice kind="warning">{`${failing} ${plural(failing, "example does", "examples do")} not give the answer you expect.`}</Notice>
              )}
              <ul className="flex flex-col gap-1 text-sm" aria-label="Test results">
                {test.results.map(resultLine)}
              </ul>
            </div>
          )}
        </Panel>

        <Panel id="versions-heading" title="Versions">
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet. Save the rules above to make version 1.</p>
          ) : (
            <>
              {turnOnBlock && <p className="text-sm text-muted-foreground">{turnOnBlock}</p>}
              <ul className={list} aria-label="Versions">
                {versions.map((v) => (
                  <li key={v.id} className={row}>
                    <span>
                      <strong>Version {v.version}</strong> <span className="text-muted-foreground">saved {formatWhen(v.createdAt)}</span>
                    </span>
                    {v.active ? (
                      <Badge variant="success">Turned on</Badge>
                    ) : (
                      <Button variant="outline" size="sm" disabled={busy || turnOnBlock !== null} aria-label={`Turn on version ${v.version}`} onClick={() => void turnOn(v)}>
                        Turn on
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      {deleting && (
        <ConfirmDialog
          open
          title={`Delete ${deleting.name || "this saved page"}?`}
          description="Its picture and text are removed and cannot be recovered."
          confirmLabel="Delete saved page"
          onConfirm={() => removeCapture(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
