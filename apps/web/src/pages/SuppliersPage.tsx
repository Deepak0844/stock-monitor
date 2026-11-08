import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, Supplier } from "../api.js";
import { Notice } from "../components/Notice.js";
import { formatWhen } from "../format.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const COLUMNS = ["Name", "Website", "Status", "Last checked", "Actions"];

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/** The one word shown for a supplier. Paused wins, because a paused supplier is not being checked whatever its session says. */
function statusOf(s: Supplier): { words: string; tone: "ok" | "warn" | "neutral" } {
  if (!s.enabled) return { words: "Paused", tone: "neutral" };
  switch (s.sessionStatus) {
    case "connected":
      return { words: "Connected", tone: "ok" };
    case "needs_reconnect":
      return { words: "Needs reconnecting", tone: "warn" };
    case "blocked":
      return { words: "Blocked", tone: "warn" };
    default:
      return { words: "Not connected", tone: "neutral" };
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function SuppliersPage({ api }: { api: Api }) {
  useTitle("Suppliers");
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api.suppliers
      .list()
      .then(setSuppliers)
      .catch((e: unknown) => setLoadError(message(e)));
  }, [api]);
  useEffect(load, [load]);
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

  const replace = (updated: Supplier) => setSuppliers((list) => list?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
  const toggle = (s: Supplier) =>
    run(async () => replace(await (s.enabled ? api.suppliers.pause(s.id) : api.suppliers.resume(s.id))));
  const remove = (s: Supplier) =>
    run(async () => {
      try {
        await api.suppliers.remove(s.id);
        setSuppliers((list) => list?.filter((x) => x.id !== s.id) ?? null);
        setDone(`Deleted ${s.name}.`);
      } finally {
        setConfirming(null);
      }
    });

  return (
    <>
      <div className="page-header">
        <h1>Suppliers</h1>
        <p className="muted">The supplier websites this app checks for stock.</p>
        {suppliers && suppliers.length > 0 && (
          <Link to="/suppliers/new" className="button primary inline">
            Add supplier
          </Link>
        )}
      </div>

      {suppliers === null && loadError === null && (
        <p role="status" className="status">
          Loading…
        </p>
      )}

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

      {suppliers && suppliers.length === 0 && (
        <section className="panel empty-state">
          <p>No suppliers yet. Add your first supplier.</p>
          <Link to="/suppliers/new" className="button primary inline">
            Add supplier
          </Link>
        </section>
      )}

      {confirming && (
        <div className="subpanel" role="group" aria-label="Confirm delete">
          <p>
            <strong>Delete {confirming.name}?</strong> This removes the supplier and cannot be undone.
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

      {suppliers && suppliers.length > 0 && (
        // Explicit roles keep this a table for screen readers when the phone layout restyles it as cards.
        <table className="data-table suppliers-table" role="table" aria-label="Suppliers" aria-busy={busy}>
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
            {suppliers.map((s) => {
              const status = statusOf(s);
              return (
                <tr key={s.id} role="row">
                  <td role="cell" data-label="Name" className="strong">
                    {s.name}
                  </td>
                  <td role="cell" data-label="Website">
                    {hostOf(s.websiteUrl)}
                  </td>
                  <td role="cell" data-label="Status">
                    <span className={`status-badge ${status.tone}`}>{status.words}</span>
                  </td>
                  <td role="cell" data-label="Last checked">
                    {s.lastSessionCheckAt ? formatWhen(s.lastSessionCheckAt) : <span className="muted">Never</span>}
                  </td>
                  <td role="cell" data-label="Actions">
                    <div className="row-actions">
                      <Link to={`/suppliers/${s.id}/edit`} className="button secondary" aria-label={`Edit ${s.name}`}>
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        aria-label={`${s.enabled ? "Pause" : "Resume"} ${s.name}`}
                        onClick={() => void toggle(s)}
                      >
                        {s.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        aria-label={`Delete ${s.name}`}
                        onClick={() => {
                          setDone(null);
                          setConfirming(s);
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
    </>
  );
}
