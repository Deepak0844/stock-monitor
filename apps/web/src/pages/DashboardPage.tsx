import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Api, AppNotification, Supplier } from "../api.js";
import { IconApprovals, IconLink, IconRefresh } from "../components/icons.js";
import { Notice } from "../components/Notice.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

function SummaryCard(props: { icon: ReactNode; title: string; value: string; note: string }) {
  const id = `card-${props.title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section className="summary" aria-labelledby={id}>
      <div className="summary-icon">{props.icon}</div>
      <h2 id={id} className="summary-title">
        {props.title}
      </h2>
      <p className="summary-value">{props.value}</p>
      <p className="summary-note">{props.note}</p>
    </section>
  );
}

const STEPS = [
  ["Check suppliers", "Stock is read from each supplier's website on a schedule you choose."],
  ["Propose changes", "When supplier stock differs from your store, a change is proposed."],
  ["You approve", "Review the current and proposed values. Approve, edit or reject."],
  ["Update Shopify", "Only approved changes are sent to your store, and the result is recorded."],
] as const;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function DashboardPage({ api }: { api: Api }) {
  useTitle("Dashboard");
  const [notes, setNotes] = useState<AppNotification[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[] | "error" | null>(null);

  const loadNotes = useCallback(() => {
    setNotesError(null);
    api.notifications
      .list()
      .then(setNotes)
      .catch((e: unknown) => setNotesError(messageOf(e)));
  }, [api]);
  useEffect(loadNotes, [loadNotes]);
  useEffect(() => {
    api.suppliers.list().then(setSuppliers).catch(() => setSuppliers("error"));
  }, [api]);

  const connected = Array.isArray(suppliers) ? suppliers.filter((s) => s.sessionStatus === "connected").length : 0;
  const total = Array.isArray(suppliers) ? suppliers.length : 0;
  const supplierCard =
    suppliers === null
      ? { value: "…", note: "Loading…" }
      : suppliers === "error"
        ? { value: "–", note: "Could not load suppliers." }
        : total === 0
          ? { value: "0", note: "No suppliers yet." }
          : { value: `${connected} of ${total}`, note: "suppliers connected." };

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">A quick view of your suppliers and what needs your approval.</p>
      </div>

      <section className="panel" aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs attention</h2>
        {notes === null && notesError === null && (
          <p role="status" className="status">
            Loading…
          </p>
        )}
        {notesError !== null && (
          <>
            <Notice kind="error" role="alert">
              {notesError}
            </Notice>
            <div className="actions">
              <button type="button" className="button primary" onClick={loadNotes}>
                Try again
              </button>
            </div>
          </>
        )}
        {notes !== null && notes.length === 0 && <p className="muted">Nothing needs your attention.</p>}
        {notes !== null && notes.length > 0 && (
          <ul className="attention-list">
            {notes.map((n) => (
              <li key={n.id}>
                <span>{n.message}</span>
                <Link to={`/suppliers/${n.supplierId}/connect`} className="button primary inline" aria-label={`Reconnect supplier ${n.supplierName}`}>
                  Reconnect supplier
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="summary-grid">
        <SummaryCard icon={<IconLink />} title="Supplier connections" value={supplierCard.value} note={supplierCard.note} />
        <SummaryCard icon={<IconRefresh />} title="Stock checks" value="None" note="No checks scheduled." />
        <SummaryCard
          icon={<IconApprovals />}
          title="Waiting for your approval"
          value="0"
          note="Nothing to review. Proposed Shopify changes will appear here."
        />
      </div>

      <section className="panel" aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className="steps" aria-labelledby="how-heading">
          {STEPS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
