import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, Capture, CaptureDetail, ExampleResult, Mapping, RecipeTest, RecipeVersion, StockAnswer, Supplier } from "../api.js";
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
  const cancelRef = useRef<HTMLButtonElement>(null);

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
  useEffect(() => {
    if (deleting) cancelRef.current?.focus();
  }, [deleting]);

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
  const removeCapture = (c: Capture) =>
    run(async () => {
      try {
        await api.captures.remove(c.id);
        setCaptures((list) => list.filter((x) => x.id !== c.id));
        if (viewing?.id === c.id) setViewing(null);
        setTest(null);
        setDone("Deleted the saved page.");
      } finally {
        setDeleting(null);
      }
    });
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
        <div className="page-header"><h1>Stock rules</h1></div>
        <Notice kind="error" role="alert">{loadError}</Notice>
        <div className="actions"><Link to="/suppliers" className="button secondary">Back to suppliers</Link></div>
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

  return (
    <>
      <div className="page-header">
        <h1>Stock rules</h1>
        <p className="muted">{supplier ? supplier.name : "Loading…"}</p>
        <p className="muted">Teach the app how this supplier's pages show stock. The app reads the words on the page, never the picture. When it cannot tell, it says so and never guesses out of stock.</p>
      </div>

      {error && <Notice kind="error" role="alert">{error}</Notice>}
      <div aria-live="polite">{done && <Notice kind="success" role="status">{done}</Notice>}</div>

      <section className="panel" aria-labelledby="pages-heading">
        <h2 id="pages-heading">Saved pages</h2>
        <p className="muted">Capture a real product page, then label saved pages with the answer you expect. Your rules are tested on them before they can be turned on.</p>
        <div className="toolbar">
          <div className="field">
            <label htmlFor="capture-link">Link to capture</label>
            <select id="capture-link" value={mappingId} onChange={(e) => setMappingId(e.target.value)}>
              <option value="">Choose a link</option>
              {links.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.productTitle} · {m.variantTitle}
                  {m.sku ? ` · ${m.sku}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="capture-name">Name (optional)</label>
            <input id="capture-name" type="text" autoComplete="off" value={captureName} onChange={(e) => setCaptureName(e.target.value)} />
          </div>
          <button type="button" className="button primary" disabled={busy} onClick={() => void requestCapture()}>
            Capture a page
          </button>
        </div>
        {captureError && <Notice kind="error" role="alert">{captureError}</Notice>}

        {deleting && (
          <div className="subpanel" role="group" aria-label="Confirm delete">
            <p><strong>Delete {deleting.name || "this saved page"}?</strong> Its picture and text are removed and cannot be recovered.</p>
            <div className="actions">
              <button type="button" className="button danger" disabled={busy} onClick={() => void removeCapture(deleting)}>Yes, delete</button>
              <button type="button" className="button secondary" ref={cancelRef} disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
            </div>
          </div>
        )}

        {captures.length === 0 ? (
          <p className="muted">No saved pages yet. Capture a page from one of this supplier's links to start.</p>
        ) : (
          <ul className="plain-list" aria-label="Saved pages">
            {captures.map((c) => {
              const name = c.name || "Unnamed capture";
              return (
                <li key={c.id}>
                  <span>
                    <strong>{name}</strong>
                    <br />
                    <span className="muted">{c.status === "pending" ? "Capturing…" : c.status === "failed" ? `Could not capture. ${captureFailureWords(c.failureReason)}` : `Saved ${formatWhen(c.createdAt)}`}</span>
                    <span className="muted">
                      {c.expectedAnswer ? ` · Expected: ${ANSWER_WORDS[c.expectedAnswer]}` : " · Not labelled"}
                      {c.keptReason === "page_changed" ? " · Kept because the page changed" : ""}
                    </span>
                    {c.expectedAnswer && (
                      <>
                        <br />
                        <span className="muted">Contains a picture of the page. Delete it when you no longer need it.</span>
                      </>
                    )}
                  </span>
                  <span className="row-actions">
                    {c.status === "ready" && (
                      <button type="button" className="button secondary" disabled={busy} aria-label={`View ${name}`} onClick={() => void view(c)}>View</button>
                    )}
                    <button type="button" className="button secondary" disabled={busy} aria-label={`Delete ${name}`} onClick={() => setDeleting(c)}>Delete</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {viewing && (
        <section className="panel" aria-labelledby="viewing-heading">
          <h2 id="viewing-heading">Saved page: {viewing.name || "Unnamed capture"}</h2>
          <div className="toolbar">
            <div className="field">
              <label htmlFor="label-name">Name</label>
              <input id="label-name" type="text" autoComplete="off" value={labelName} onChange={(e) => setLabelName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="label-expected">Answer you expect</label>
              <select id="label-expected" value={labelExpected} onChange={(e) => setLabelExpected(e.target.value as StockAnswer | "")}>
                <option value="">Not labelled</option>
                <option value="in_stock">In stock</option>
                <option value="out_of_stock">Out of stock</option>
                <option value="cannot_tell">Cannot tell</option>
              </select>
            </div>
            <button type="button" className="button secondary" disabled={busy} onClick={() => void saveLabel(viewing)}>Save label</button>
          </div>
          {viewing.hasPicture && <img className="capture-picture" src={api.captures.pictureUrl(viewing.id)} alt="Picture of the saved page" />}
          {viewing.description && (
            <div className="capture-text">
              <h3>What the page said</h3>
              {viewing.description.sections.map((s, i) => (
                <div key={i}>
                  {s.heading !== null && <h4>{s.heading}</h4>}
                  <ul className="plain-list">
                    {s.lines.map((line, j) => (
                      <li key={j}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <h3>Buttons</h3>
              <ul className="plain-list">
                {viewing.description.buttons.map((b, i) => (
                  <li key={i}>
                    {b.label} ({b.enabled ? "enabled" : "disabled"}
                    {b.section ? `, under ${b.section}` : ""})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="panel" aria-labelledby="rules-heading">
        <h2 id="rules-heading">Rules</h2>
        <RuleEditor draft={draft} onChange={(d) => { setDraft(d); setTest(null); }} />
        <div className="actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => void runTest()}>Test all examples</button>
          <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>Save version</button>
        </div>
        {test && (
          <div aria-live="polite">
            {test.results.length === 0 ? (
              <Notice kind="warning">There are no labelled saved pages to test yet. Label a saved page with the answer you expect.</Notice>
            ) : test.passed ? (
              <Notice kind="success">All examples give the answer you expect.</Notice>
            ) : (
              <Notice kind="warning">{`${failing} ${plural(failing, "example does", "examples do")} not give the answer you expect.`}</Notice>
            )}
            <ul className="plain-list" aria-label="Test results">{test.results.map(resultLine)}</ul>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="versions-heading">
        <h2 id="versions-heading">Versions</h2>
        {versions.length === 0 ? (
          <p className="muted">No versions yet. Save the rules above to make version 1.</p>
        ) : (
          <>
            {turnOnBlock && <p className="muted">{turnOnBlock}</p>}
            <ul className="plain-list" aria-label="Versions">
              {versions.map((v) => (
                <li key={v.id}>
                  <span>
                    <strong>Version {v.version}</strong> <span className="muted">saved {formatWhen(v.createdAt)}</span>
                  </span>
                  {v.active ? (
                    <span className="status-badge ok">Turned on</span>
                  ) : (
                    <button type="button" className="button secondary" disabled={busy || turnOnBlock !== null} aria-label={`Turn on version ${v.version}`} onClick={() => void turnOn(v)}>
                      Turn on
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
