import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, ScheduleRow, Supplier } from "../api.js";
import { Notice } from "../components/Notice.js";
import { intervalWords, runSummary, whenWords } from "../components/scheduleWords.js";
import { formatWhen } from "../format.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const CHECK_REFRESH_MS = 4000;
const CHECK_REFRESHES = 12;
const COLUMNS = ["Name", "Website", "Status", "Last checked", "Automatic checks", "Actions"];
// While a run is going, its progress is read again this often.
const PROGRESS_REFRESH_MS = 5000;

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/**
 * The one word shown for a supplier. Paused wins when the owner paused it. When the app paused it because its login
 * needs attention, the reason is what the owner has to act on, so that is shown instead.
 */
function statusOf(s: Supplier): { words: string; tone: "ok" | "warn" | "neutral" } {
  if (!s.enabled && s.pausedReason !== "session") return { words: "Paused", tone: "neutral" };
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

/** What the schedule is doing for one supplier, in a few plain lines. */
function ScheduleCell({ row }: { row: ScheduleRow | undefined }) {
  if (!row || row.status.state === "off") return <span className="muted">Automatic checks off</span>;
  const status = row.status;
  return (
    <>
      {status.state === "running" && row.run ? (
        <span role="status">{runSummary(row.run)}</span>
      ) : status.state === "not_checked" ? (
        <span>Not being checked. {status.message}</span>
      ) : (
        <span>
          {intervalWords(row.intervalMinutes)}, next check {whenWords(row.nextCheckAt)}
        </span>
      )}
      {status.state !== "running" && row.lastRun && <div className="muted">{runSummary(row.lastRun)}</div>}
    </>
  );
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
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api.suppliers
      .list()
      .then(setSuppliers)
      .catch((e: unknown) => setLoadError(message(e)));
  }, [api]);
  useEffect(load, [load]);
  // The schedule and any run's progress. Read once, and again every few seconds for as long as a run is going. A failure only
  // leaves the column as it was: the suppliers themselves still show.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () =>
      api.schedule
        .overview()
        .then((rows) => {
          if (cancelled) return;
          setSchedule(rows);
          if (rows.some((r) => r.status.state === "running")) timer = setTimeout(read, PROGRESS_REFRESH_MS);
        })
        .catch(() => {});
    void read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api]);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);
  // A check takes a moment. The list is read again shortly after one is asked for, and never after the page is left.
  useEffect(() => () => void (refreshTimer.current && clearTimeout(refreshTimer.current)), []);

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
  /** Reads the list again, a few times a few seconds apart, because a check finishes some moments after it is asked for. */
  const refreshSoon = (times: number, done: (list: Supplier[]) => boolean) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      api.suppliers
        .list()
        .then((list) => {
          setSuppliers(list);
          if (!done(list) && times > 1) refreshSoon(times - 1, done);
        })
        .catch(() => {});
    }, CHECK_REFRESH_MS);
  };
  const check = (s: Supplier) =>
    run(async () => {
      await api.suppliers.checkSession(s.id);
      setDone(`A check of ${s.name} has started. Its status will update in a moment.`);
      refreshSoon(CHECK_REFRESHES, (list) => list.find((x) => x.id === s.id)?.lastSessionCheckAt !== s.lastSessionCheckAt);
    });
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
                  <td role="cell" data-label="Automatic checks">
                    <ScheduleCell row={schedule.find((r) => r.supplierId === s.id)} />
                  </td>
                  <td role="cell" data-label="Actions">
                    <div className="row-actions">
                      {s.sessionStatus === "connected" ? (
                        <button type="button" className="button secondary" disabled={busy} aria-label={`Check connection ${s.name}`} onClick={() => void check(s)}>
                          Check connection
                        </button>
                      ) : s.sessionStatus === "not_connected" ? (
                        <Link to={`/suppliers/${s.id}/connect`} className="button secondary" aria-label={`Connect ${s.name}`}>
                          Connect
                        </Link>
                      ) : (
                        <Link to={`/suppliers/${s.id}/connect`} className="button primary inline" aria-label={`Reconnect supplier ${s.name}`}>
                          Reconnect supplier
                        </Link>
                      )}
                      <Link to={`/suppliers/${s.id}/rules`} className="button secondary" aria-label={`Stock rules ${s.name}`}>
                        Stock rules
                      </Link>
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
