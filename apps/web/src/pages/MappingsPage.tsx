import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, LinkStatus, Mapping, Observation, Supplier, UnmappedList } from "../api.js";
import { LINK_STATUS_OPTIONS, linkStatusOf } from "../components/linkStatus.js";
import { Notice } from "../components/Notice.js";
import { ANSWER_TONE, reasonWords, stockSentence } from "../components/stockWords.js";
import { formatDay, formatWhen } from "../format.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const COLUMNS = ["Product", "Supplier", "Page", "Status", "Stock", "Last checked", "Actions"];
const SHOW_UNMAPPED = 50;
const SEARCH_DELAY_MS = 250;

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const where = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
};

/** Waits a moment after typing stops, so each keystroke is not a request. */
function useDelayed(value: string): string {
  const [delayed, setDelayed] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(value), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return delayed;
}

export function MappingsPage({ api }: { api: Api }) {
  useTitle("Links");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [mappings, setMappings] = useState<Mapping[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Mapping | null>(null);
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<LinkStatus | "">("");
  const [search, setSearch] = useState("");
  const [variantSearch, setVariantSearch] = useState("");
  const [unmapped, setUnmapped] = useState<UnmappedList | null>(null);
  const [history, setHistory] = useState<{ mapping: Mapping; items: Observation[] } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const q = useDelayed(search);
  const vq = useDelayed(variantSearch);

  useEffect(() => {
    api.suppliers.list().then(setSuppliers).catch(() => {});
  }, [api]);

  const load = useCallback(() => {
    setLoadError(null);
    api.mappings
      .list({ ...(supplierId ? { supplierId } : {}), ...(status ? { status } : {}), ...(q ? { search: q } : {}) })
      .then(setMappings)
      .catch((e: unknown) => setLoadError(message(e)));
  }, [api, supplierId, status, q]);
  useEffect(load, [load]);

  useEffect(() => {
    api.mappings.unmapped(vq || undefined).then(setUnmapped).catch(() => setUnmapped(null));
  }, [api, vq, mappings]);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    setDone(null);
    try {
      await work();
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const label = (m: Mapping) => `${m.productTitle} ${m.variantTitle}`;
  const checkOne = (m: Mapping) =>
    run(async () => {
      await api.mappings.checkLink(m.id);
      setDone(`A check of ${m.productTitle} (${m.variantTitle}) has started. Its status will update in a moment.`);
    });
  const checkStock = (m: Mapping) =>
    run(async () => {
      await api.stock.checkLink(m.id);
      setDone(`A stock check of ${m.productTitle} (${m.variantTitle}) has started. The answer will appear here in a moment.`);
    });
  const checkAllStock = (s: Supplier) =>
    run(async () => {
      const n = await api.stock.checkSupplier(s.id);
      setDone(`Checking stock for ${n} ${n === 1 ? "link" : "links"} for ${s.name}, one page at a time. Answers will appear as they finish.`);
    });
  const toggleHistory = (m: Mapping) =>
    run(async () => {
      if (history?.mapping.id === m.id) return setHistory(null);
      setHistory({ mapping: m, items: await api.stock.observations(m.id) });
    });
  const supplier = suppliers.find((s) => s.id === supplierId);
  const checkAll = (s: Supplier) =>
    run(async () => {
      const n = await api.mappings.checkSupplierLinks(s.id);
      setDone(`Checking ${n} ${n === 1 ? "link" : "links"} for ${s.name}, one page at a time. Statuses will update as they finish.`);
    });
  const remove = (m: Mapping) =>
    run(async () => {
      try {
        await api.mappings.remove(m.id);
        setMappings((list) => list?.filter((x) => x.id !== m.id) ?? null);
        setDone(`Deleted the link for ${m.productTitle} (${m.variantTitle}).`);
      } finally {
        setConfirming(null);
      }
    });

  const filtered = supplierId !== "" || status !== "" || q !== "";
  return (
    <>
      <div className="page-header">
        <h1>Links</h1>
        <p className="muted">Which supplier page each of your Shopify variants matches.</p>
        <div className="actions">
          <Link to="/mappings/new" className="button primary inline">
            Add link
          </Link>
          <Link to="/mappings/import" className="button secondary">
            Import from Shopify export
          </Link>
        </div>
      </div>

      {loadError !== null && (
        <>
          <Notice kind="error" role="alert">
            {loadError}
          </Notice>
          <div className="actions">
            <button type="button" className="button primary" onClick={load}>
              Try again
            </button>
          </div>
        </>
      )}
      {actionError && (
        <Notice kind="error" role="alert">
          {actionError}
        </Notice>
      )}
      <div aria-live="polite">{done && <Notice kind="success" role="status">{done}</Notice>}</div>

      {mappings === null && loadError === null && (
        <p role="status" className="status">
          Loading…
        </p>
      )}

      {mappings !== null && (
        <section className="panel" aria-label="Links">
          <div className="toolbar">
            <div className="field">
              <label htmlFor="link-supplier">Supplier</label>
              <select id="link-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">All suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="link-status">Link status</label>
              <select id="link-status" value={status} onChange={(e) => setStatus(e.target.value as LinkStatus | "")}>
                <option value="">Any status</option>
                {LINK_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.words}
                  </option>
                ))}
              </select>
            </div>
            <div className="field search">
              <label htmlFor="link-search">Search links</label>
              <input id="link-search" type="search" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {supplier && (
              <>
                <button type="button" className="button secondary" disabled={busy} onClick={() => void checkAll(supplier)}>
                  Check all links for {supplier.name}
                </button>
                <button type="button" className="button secondary" disabled={busy} onClick={() => void checkAllStock(supplier)}>
                  Check all stock for {supplier.name}
                </button>
              </>
            )}
          </div>

          {confirming && (
            <div className="subpanel" role="group" aria-label="Confirm delete">
              <p>
                <strong>Delete the link for {label(confirming)}?</strong> The product stays in Shopify. Only the link to the supplier page is removed.
              </p>
              <div className="actions">
                <button type="button" className="button danger" disabled={busy} onClick={() => void remove(confirming)}>
                  Yes, delete
                </button>
                <button type="button" className="button secondary" ref={cancelRef} disabled={busy} onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mappings.length === 0 ? (
            <div className="empty-state">
              <p>{filtered ? "No links match those filters." : "No links yet. Add one by hand, or import them from your Shopify export."}</p>
              {!filtered && (
                <div className="actions">
                  <Link to="/mappings/new" className="button primary inline">
                    Add link
                  </Link>
                  <Link to="/mappings/import" className="button secondary">
                    Import from Shopify export
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <table className="data-table links-table" role="table" aria-label="Links" aria-busy={busy}>
              <thead role="rowgroup">
                <tr role="row">
                  {COLUMNS.map((c) => (
                    <th key={c} role="columnheader" scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {mappings.map((m) => {
                  const s = linkStatusOf(m);
                  return (
                    <tr key={m.id} role="row">
                      <td role="cell" data-label="Product" className="strong">
                        {m.productTitle}
                        <div className="muted">{m.sku ? `${m.variantTitle} · ${m.sku}` : m.variantTitle}</div>
                        {m.variantRemoved && <div className="muted">Variant removed in Shopify</div>}
                      </td>
                      <td role="cell" data-label="Supplier">
                        {m.supplierName}
                      </td>
                      <td role="cell" data-label="Page">
                        {where(m.url)}
                      </td>
                      <td role="cell" data-label="Status">
                        <span className={`status-badge ${s.tone}`}>{s.words}</span>
                        {m.unavailableCandidate && (
                          <div>
                            <span className="status-badge warn">May be unavailable</span>
                          </div>
                        )}
                        {s.hint && <div className="muted">{s.hint}</div>}
                        {m.linkStatus === "page_missing" && m.lastWorkedAt && <div className="muted">Worked until {formatDay(m.lastWorkedAt)}</div>}
                      </td>
                      <td role="cell" data-label="Stock">
                        {m.latestStock ? (
                          <>
                            <span className={`status-badge ${ANSWER_TONE[m.latestStock.answer]}`}>
                              {stockSentence(m.latestStock, m.region ?? suppliers.find((x) => x.id === m.supplierId)?.defaultRegion)}
                            </span>
                            {reasonWords(m.latestStock.reason) && m.latestStock.reason !== "not_listed" && <div className="muted">{reasonWords(m.latestStock.reason)}</div>}
                            {m.latestStock.reason === "page_changed" && (
                              <div>
                                <Link to={`/suppliers/${m.supplierId}/rules`} className="button secondary">
                                  Review stock rules
                                </Link>
                              </div>
                            )}
                            <div className="muted">Seen {formatWhen(m.latestStock.observedAt)}</div>
                          </>
                        ) : (
                          <span className="muted">No stock check yet</span>
                        )}
                      </td>
                      <td role="cell" data-label="Last checked">
                        {m.lastLinkCheckAt ? formatWhen(m.lastLinkCheckAt) : <span className="muted">Never</span>}
                      </td>
                      <td role="cell" data-label="Actions">
                        <div className="row-actions">
                          <button type="button" className="button secondary" disabled={busy || !m.enabled} aria-label={`Check now ${label(m)}`} onClick={() => void checkOne(m)}>
                            Check now
                          </button>
                          <button type="button" className="button secondary" disabled={busy || !m.enabled} aria-label={`Check stock ${label(m)}`} onClick={() => void checkStock(m)}>
                            Check stock
                          </button>
                          <button type="button" className="button secondary" disabled={busy} aria-label={`${history?.mapping.id === m.id ? "Hide" : "Show"} history ${label(m)}`} onClick={() => void toggleHistory(m)}>
                            {history?.mapping.id === m.id ? "Hide history" : "History"}
                          </button>
                          <Link to={`/mappings/${m.id}/edit`} className="button secondary" aria-label={`Edit link ${label(m)}`}>
                            Edit
                          </Link>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={busy}
                            aria-label={`Delete link ${label(m)}`}
                            onClick={() => {
                              setDone(null);
                              setConfirming(m);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {history && (
            <div className="subpanel">
              <h3>Stock history for {label(history.mapping)}</h3>
              {history.items.length === 0 ? (
                <p className="muted">No stock checks yet.</p>
              ) : (
                <ul className="plain-list" aria-label={`Stock history for ${label(history.mapping)}`}>
                  {history.items.map((o) => (
                    <li key={o.id}>
                      <span>
                        <strong>{stockSentence(o, history.mapping.region)}</strong> · {formatWhen(o.observedAt)}
                        {o.recipeVersion !== null ? ` · rules version ${o.recipeVersion}` : ""}
                        {reasonWords(o.reason) && o.reason !== "not_listed" ? ` · ${reasonWords(o.reason)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {unmapped && (
        <section className="panel" aria-labelledby="unmapped-heading">
          <h2 id="unmapped-heading">Variants with no link</h2>
          {unmapped.unmapped === 0 && !vq ? (
            <p className="muted">Every variant has a link.</p>
          ) : (
            <>
              <p className="count">
                {unmapped.unmapped} of {unmapped.total} variants are not mapped
              </p>
              <div className="field search">
                <label htmlFor="variant-search">Search variants with no link</label>
                <input id="variant-search" type="search" autoComplete="off" value={variantSearch} onChange={(e) => setVariantSearch(e.target.value)} />
              </div>
              <ul className="plain-list">
                {unmapped.items.slice(0, SHOW_UNMAPPED).map((v) => (
                  <li key={v.variantId} className="row-actions">
                    <span>
                      {v.productTitle} · {v.variantTitle}
                      {v.sku ? ` · ${v.sku}` : ""}
                    </span>
                    <Link to={`/mappings/new?variant=${encodeURIComponent(v.variantId)}`} className="button secondary" aria-label={`Map ${v.productTitle} ${v.variantTitle}`}>
                      Map
                    </Link>
                  </li>
                ))}
              </ul>
              {unmapped.items.length > SHOW_UNMAPPED && <p className="muted">Showing the first {SHOW_UNMAPPED}. Search to narrow the list.</p>}
            </>
          )}
        </section>
      )}
    </>
  );
}
