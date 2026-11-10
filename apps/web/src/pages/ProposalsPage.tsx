import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_QUANTITY } from "@stock-monitor/proposals";
import type { Api, Proposal, WritePermission } from "../api.js";
import { ANSWER_WORDS } from "../components/stockWords.js";
import { Notice } from "../components/Notice.js";
import { closedWords, kindWords, resultWords, stateTone, stateWords } from "../components/proposalWords.js";
import { formatWhen } from "../format.js";
import { useTitle } from "../useTitle.js";

const POLL_MS = 5000;
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const NOT_A_NUMBER = "Enter a whole number from 0 up.";
const name = (p: Proposal) => `${p.productTitle}, ${p.variantTitle}`;

type Open = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; proposals: Proposal[]; permission: WritePermission };

/** One suggestion waiting for the owner. Approve is one press on this one suggestion. */
function OpenItem({ api, proposal, permission, onChanged }: { api: Api; proposal: Proposal; permission: WritePermission; onChanged: (p: Proposal) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(proposal.proposedQuantity));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = proposal.state === "approved";
  const refusal = permission.state !== "ready" || proposal.blockedReason;
  // Why Approve is off: this item's own reason, or the permission notice at the top of the page.
  const refusalId = proposal.blockedReason ? `refusal-${proposal.id}` : "permission-notice";

  async function approve() {
    setError(null);
    let quantity: number | undefined;
    if (editing) {
      if (!/^\d+$/.test(text.trim()) || Number(text) > MAX_QUANTITY) return setError(NOT_A_NUMBER);
      quantity = Number(text) === proposal.proposedQuantity ? undefined : Number(text);
    }
    setBusy(true);
    try {
      onChanged(await api.proposals.approve(proposal.id, quantity));
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }

  async function reject() {
    setError(null);
    setBusy(true);
    try {
      onChanged(await api.proposals.reject(proposal.id));
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }

  return (
    <li className="panel proposal" aria-label={name(proposal)}>
      <div className="proposal-head">
        <h2>
          <span>{proposal.productTitle}</span> <span className="muted">{proposal.variantTitle}</span>
        </h2>
        <span className={`status-badge ${waiting ? "neutral" : "warn"}`}>{kindWords(proposal.kind)}</span>
      </div>
      {proposal.sku && <p className="muted">SKU {proposal.sku}</p>}
      {proposal.observed && (
        <p>
          {proposal.supplierName} said {ANSWER_WORDS[proposal.observed.answer]}
          {proposal.observed.at ? `, seen ${formatWhen(proposal.observed.at)}` : ""}.
        </p>
      )}
      <p>Shopify shows {proposal.shopifyQuantitySeen}</p>
      <p className="proposal-change">Suggested: set to {waiting ? proposal.approvedQuantity : proposal.proposedQuantity}</p>
      <p className="muted">
        {stateWords(proposal.state)}
        {waiting ? "" : ` · Expires ${formatWhen(proposal.expiresAt)}`}
      </p>
      {proposal.continueSelling && !waiting && <Notice kind="warning">Shopify is set to keep selling when stock is 0, so customers can still buy this even at 0.</Notice>}
      {proposal.blockedReason && !waiting && (
        <p id={refusalId} className="muted">
          {proposal.blockedReason}
        </p>
      )}
      {!waiting && (
        <>
          {editing && (
            <div className="field">
              <label htmlFor={`qty-${proposal.id}`}>New number</label>
              <input id={`qty-${proposal.id}`} inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={error === NOT_A_NUMBER} />
            </div>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="button" className="button primary" disabled={busy || Boolean(refusal)} aria-describedby={refusal ? refusalId : undefined} aria-label={`Approve ${name(proposal)}`} onClick={() => void approve()}>
              Approve
            </button>
            {!editing && (
              <button type="button" className="button secondary" disabled={busy} aria-label={`Edit number for ${name(proposal)}`} onClick={() => setEditing(true)}>
                Edit number
              </button>
            )}
            <button type="button" className="button secondary" disabled={busy} aria-label={`Reject ${name(proposal)}`} onClick={() => void reject()}>
              Reject
            </button>
          </div>
        </>
      )}
    </li>
  );
}

const REFRESHABLE = new Set(["conflict", "failed", "expired"]);

function History({ api }: { api: Api }) {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (next: number) => {
      setError(null);
      api.proposals
        .history(next)
        .then((r) => {
          setRows(r.proposals);
          setPage(r.page);
          setMore(r.hasMore);
        })
        .catch((e: unknown) => setError(message(e)));
    },
    [api],
  );
  useEffect(() => load(1), [load]);

  async function refresh(p: Proposal) {
    setRefreshError(null);
    setRefreshed(false);
    try {
      await api.proposals.refresh(p.id);
      setRefreshed(true);
    } catch (e) {
      setRefreshError(message(e));
    }
  }

  if (error) {
    return (
      <>
        <Notice kind="error" role="alert">
          {error}
        </Notice>
        <div className="actions">
          <button type="button" className="button primary" onClick={() => load(page)}>
            Try again
          </button>
        </div>
      </>
    );
  }
  if (!rows) return <p role="status" className="status">Loading…</p>;
  if (rows.length === 0) return <p className="empty-state">No past suggestions yet.</p>;
  return (
    <>
      {refreshed && <Notice kind="info" role="status">Reading Shopify again. If a suggestion still applies, it will appear under Waiting in a moment.</Notice>}
      {refreshError && (
        <Notice kind="error" role="alert">
          {refreshError}
        </Notice>
      )}
      <table className="data-table" aria-label="Past suggestions">
        <thead>
          <tr>
            {["Product", "Supplier", "Shopify showed", "Suggested", "Result"].map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td data-label="Product">
                <span>{p.productTitle}</span> <span className="muted">{p.variantTitle}</span>
                {p.sku && <div className="muted">SKU {p.sku}</div>}
              </td>
              <td data-label="Supplier">{p.supplierName}</td>
              <td data-label="Shopify showed">{p.shopifyQuantitySeen}</td>
              <td data-label="Suggested">Set to {p.approvedQuantity ?? p.proposedQuantity}{p.edited ? " (edited)" : ""}</td>
              <td data-label="Result">
                <span className={`status-badge ${stateTone(p.state)}`}>{stateWords(p.state)}</span>
                {(resultWords(p.state, p.resultCode, p.resultQuantity) ?? closedWords(p.closedReason)) && (
                  <div className="muted">{resultWords(p.state, p.resultCode, p.resultQuantity) ?? closedWords(p.closedReason)}</div>
                )}
                {p.decidedAt && <div className="muted">{formatWhen(p.decidedAt)}</div>}
                {REFRESHABLE.has(p.state) && (
                  <div>
                    <button type="button" className="button secondary" aria-label={`Refresh ${name(p)}`} onClick={() => void refresh(p)}>
                      Refresh
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pager">
        {more && (
          <button type="button" className="button secondary" onClick={() => load(page + 1)}>
            Older
          </button>
        )}
      </div>
    </>
  );
}

/** Suggested changes to Shopify stock, one at a time, and what became of the past ones. */
export function ProposalsPage({ api, onChange }: { api: Api; onChange?: () => void }) {
  useTitle("Proposals");
  const [tab, setTab] = useState<"open" | "history">("open");
  const [open, setOpen] = useState<Open>({ kind: "loading" });
  const [finished, setFinished] = useState(false);
  const waitingIds = useRef<Set<string>>(new Set());

  const read = useCallback(
    (quiet = false) => {
      if (!quiet) setOpen({ kind: "loading" });
      api.proposals
        .open()
        .then((r) => {
          // One that was waiting for Shopify and has gone has finished: its result is in History.
          if ([...waitingIds.current].some((id) => !r.proposals.some((p) => p.id === id))) setFinished(true);
          waitingIds.current = new Set(r.proposals.filter((p) => p.state === "approved").map((p) => p.id));
          setOpen({ kind: "ready", proposals: r.proposals, permission: r.writePermission });
          onChange?.();
        })
        .catch((e: unknown) => {
          if (!quiet) setOpen({ kind: "error", message: message(e) });
        });
    },
    [api, onChange],
  );
  useEffect(() => read(), [read]);

  // While something waits for Shopify, look again every few seconds.
  const waiting = open.kind === "ready" && open.proposals.some((p) => p.state === "approved");
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => read(true), POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, open, read]);

  function changed(next: Proposal) {
    setOpen((current) => {
      if (current.kind !== "ready") return current;
      if (next.state === "approved") waitingIds.current.add(next.id);
      return { ...current, proposals: next.state === "open" || next.state === "approved" ? current.proposals.map((p) => (p.id === next.id ? next : p)) : current.proposals.filter((p) => p.id !== next.id) };
    });
    onChange?.();
  }

  const items = open.kind === "ready" ? open.proposals : [];
  return (
    <>
      <div className="page-header">
        <h1>Proposals</h1>
        <p className="muted">Changes this app suggests to your Shopify stock. Nothing changes in Shopify until you press Approve.</p>
      </div>

      <div className="tabs" role="group" aria-label="Show">
        <button type="button" className="button secondary" aria-pressed={tab === "open"} onClick={() => setTab("open")}>
          Waiting
        </button>
        <button type="button" className="button secondary" aria-pressed={tab === "history"} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {tab === "history" && <History api={api} />}

      {tab === "open" && (
        <>
          {open.kind === "loading" && (
            <p role="status" className="status">
              Loading…
            </p>
          )}
          {open.kind === "error" && (
            <>
              <Notice kind="error" role="alert">
                {open.message}
              </Notice>
              <div className="actions">
                <button type="button" className="button primary" onClick={() => read()}>
                  Try again
                </button>
              </div>
            </>
          )}
          {open.kind === "ready" && open.permission.state !== "ready" && (
            <div id="permission-notice">
              <Notice kind="warning">{open.permission.message}</Notice>
            </div>
          )}
          {finished && <Notice kind="info" role="status">A suggestion you approved has finished. See History for the result.</Notice>}
          {open.kind === "ready" && items.length === 0 && <p className="empty-state">Nothing is waiting for you. New suggestions appear here after a supplier check finds a difference.</p>}
          {open.kind === "ready" && items.length > 0 && (
            <ul className="proposal-list">
              {items.map((p) => (
                <OpenItem key={p.id} api={api} proposal={p} permission={open.permission} onChanged={changed} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
