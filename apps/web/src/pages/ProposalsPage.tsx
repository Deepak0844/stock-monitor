import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_QUANTITY } from "@stock-monitor/proposals";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, Proposal, WritePermission } from "../api.js";
import { DataTable, type Column } from "../components/DataTable.js";
import { EmptyState } from "../components/EmptyState.js";
import { Field } from "../components/Field.js";
import { PageHeader } from "../components/PageHeader.js";
import { Pager } from "../components/Pager.js";
import { ANSWER_WORDS } from "../components/stockWords.js";
import { Notice } from "../components/Notice.js";
import { closedWords, kindWords, resultWords, stateTone, stateWords } from "../components/proposalWords.js";
import { badgeVariant } from "../components/tone.js";
import { formatWhen } from "../format.js";
import { useListParams, type ListParams } from "../lib/useListParams.js";
import { useTitle } from "../useTitle.js";
import { toast } from "../lib/toast.js";

const POLL_MS = 5000;
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const NOT_A_NUMBER = "Enter a whole number from 0 up.";
const name = (p: Proposal) => `${p.productTitle}, ${p.variantTitle}`;

type Open = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; proposals: Proposal[]; total: number; permission: WritePermission };

/** One suggestion waiting for the owner. Approve is one press on this one suggestion. */
function OpenItem({ api, proposal, permission, onChanged }: { api: Api; proposal: Proposal; permission: WritePermission; onChanged: (p: Proposal) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(proposal.proposedQuantity));
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);
  const busy = acting !== null;
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
    setActing("approve");
    try {
      onChanged(await api.proposals.approve(proposal.id, quantity));
    } catch (e) {
      setError(message(e));
      setActing(null);
    }
  }

  async function reject() {
    setError(null);
    setActing("reject");
    try {
      onChanged(await api.proposals.reject(proposal.id));
    } catch (e) {
      setError(message(e));
      setActing(null);
    }
  }

  return (
    <li aria-label={name(proposal)}>
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-semibold">
            <span>{proposal.productTitle}</span> <span className="font-normal text-muted-foreground">{proposal.variantTitle}</span>
          </h2>
          <Badge variant={waiting ? "neutral" : "warning"}>{kindWords(proposal.kind)}</Badge>
        </div>
        {proposal.sku && <p className="text-sm text-muted-foreground">SKU {proposal.sku}</p>}
        {proposal.observed && (
          <p className="text-sm">
            {proposal.supplierName} said {ANSWER_WORDS[proposal.observed.answer]}
            {proposal.observed.at ? `, seen ${formatWhen(proposal.observed.at)}` : ""}.
          </p>
        )}
        <p className="text-sm">Shopify shows {proposal.shopifyQuantitySeen}</p>
        <p className="text-lg font-bold">Suggested: set to {waiting ? proposal.approvedQuantity : proposal.proposedQuantity}</p>
        <p className="text-sm text-muted-foreground">
          {stateWords(proposal.state)}
          {waiting ? "" : ` · Expires ${formatWhen(proposal.expiresAt)}`}
        </p>
        {proposal.continueSelling && !waiting && <Notice kind="warning">Shopify is set to keep selling when stock is 0, so customers can still buy this even at 0.</Notice>}
        {proposal.blockedReason && !waiting && (
          <p id={refusalId} className="text-sm text-muted-foreground">
            {proposal.blockedReason}
          </p>
        )}
        {!waiting && (
          <>
            {editing && (
              <div className="max-w-xs">
                <Field id={`qty-${proposal.id}`} label="New number">
                  <Input id={`qty-${proposal.id}`} inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={error === NOT_A_NUMBER} />
                </Field>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-2">
              <Button loading={acting === "approve"} disabled={busy || Boolean(refusal)} aria-describedby={refusal ? refusalId : undefined} aria-label={`Approve ${name(proposal)}`} onClick={() => void approve()}>
                Approve
              </Button>
              {!editing && (
                <Button variant="outline" disabled={busy} aria-label={`Edit number for ${name(proposal)}`} onClick={() => setEditing(true)}>
                  Edit number
                </Button>
              )}
              <Button variant="outline" loading={acting === "reject"} disabled={busy} aria-label={`Reject ${name(proposal)}`} onClick={() => void reject()}>
                Reject
              </Button>
            </div>
          </>
        )}
      </Card>
    </li>
  );
}

const REFRESHABLE = new Set(["conflict", "failed", "expired"]);

function History({ api, params }: { api: Api; params: ListParams }) {
  const { page, pageSize, set } = params;
  const [data, setData] = useState<{ items: Proposal[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(0);

  const load = useCallback(() => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    api.proposals
      .history(page, pageSize)
      .then((r) => {
        if (mine !== latest.current) return; // a newer page was asked for since
        setData({ items: r.proposals, total: r.total });
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (mine !== latest.current) return;
        setError(message(e));
        setLoading(false);
      });
  }, [api, page, pageSize]);
  useEffect(load, [load]);

  const busy = useRef<Set<string>>(new Set());
  async function refresh(p: Proposal) {
    if (busy.current.has(p.id)) return;
    busy.current.add(p.id);
    setRefreshing(new Set(busy.current));
    setRefreshError(null);
    try {
      await api.proposals.refresh(p.id);
      toast("Reading Shopify again. If a suggestion still applies, it will appear under Waiting in a moment.");
    } catch (e) {
      setRefreshError(message(e));
    } finally {
      busy.current.delete(p.id);
      setRefreshing(new Set(busy.current));
    }
  }

  const columns: Column<Proposal>[] = [
    {
      header: "Product",
      cell: (p) => (
        <>
          <span className="font-semibold">{p.productTitle}</span> <span className="text-muted-foreground">{p.variantTitle}</span>
          {p.sku && <div className="text-muted-foreground">SKU {p.sku}</div>}
        </>
      ),
    },
    { header: "Supplier", cell: (p) => p.supplierName },
    { header: "Shopify showed", cell: (p) => p.shopifyQuantitySeen },
    { header: "Suggested", cell: (p) => `Set to ${p.approvedQuantity ?? p.proposedQuantity}${p.edited ? " (edited)" : ""}` },
    {
      header: "Result",
      cell: (p) => {
        const words = resultWords(p.state, p.resultCode, p.resultQuantity) ?? closedWords(p.closedReason);
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={badgeVariant(stateTone(p.state))}>{stateWords(p.state)}</Badge>
            {words && <span className="text-muted-foreground">{words}</span>}
            {p.decidedAt && <span className="text-muted-foreground">{formatWhen(p.decidedAt)}</span>}
            {REFRESHABLE.has(p.state) && (
              <Button variant="outline" size="sm" aria-label={`Refresh ${name(p)}`} loading={refreshing.has(p.id)} onClick={() => void refresh(p)}>
                Refresh
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      {refreshError && (
        <div className="mb-4">
          <Notice kind="error" role="alert">
            {refreshError}
          </Notice>
        </div>
      )}
      <Card className="overflow-hidden">
        <DataTable
          label="Past suggestions"
          columns={columns}
          rows={data === null || (data.items.length === 0 && data.total > 0) ? null : data.items}
          rowKey={(p) => p.id}
          loading={loading}
          error={error}
          onRetry={load}
          pageSize={pageSize}
          empty={<EmptyState title="No past suggestions yet." />}
        />
        {data !== null && data.total > 0 && <Pager page={page} pageSize={pageSize} total={data.total} onPage={(n) => set({ page: n })} onPageSize={(n) => set({ pageSize: n })} />}
      </Card>
    </>
  );
}

/** Suggested changes to Shopify stock, one at a time, and what became of the past ones. */
export function ProposalsPage({ api, onChange }: { api: Api; onChange?: () => void }) {
  useTitle("Proposals");
  const params = useListParams({ pageSize: 10 });
  const { page, pageSize, set } = params;
  const tab = params.filters.tab === "history" ? "history" : "open";
  const [open, setOpen] = useState<Open>({ kind: "loading" });
  const [finished, setFinished] = useState(false);
  const waitingIds = useRef<Set<string>>(new Set());

  const read = useCallback(
    (quiet = false) => {
      if (!quiet) setOpen({ kind: "loading" });
      api.proposals
        .openPage({ page, pageSize })
        .then((r) => {
          // One that was waiting for Shopify and has gone has finished: its result is in History.
          if ([...waitingIds.current].some((id) => !r.items.some((p) => p.id === id))) setFinished(true);
          waitingIds.current = new Set(r.items.filter((p) => p.state === "approved").map((p) => p.id));
          setOpen({ kind: "ready", proposals: r.items, total: r.total, permission: r.writePermission });
          onChange?.();
        })
        .catch((e: unknown) => {
          if (!quiet) setOpen({ kind: "error", message: message(e) });
        });
    },
    [api, onChange, page, pageSize],
  );
  useEffect(() => {
    if (tab === "open") read();
  }, [read, tab]);

  // While something waits for Shopify, look again every few seconds.
  const waiting = tab === "open" && open.kind === "ready" && open.proposals.some((p) => p.state === "approved");
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => read(true), POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, open, read]);

  function changed(next: Proposal) {
    let reload = false;
    setOpen((current) => {
      if (current.kind !== "ready") return current;
      if (next.state === "approved") waitingIds.current.add(next.id);
      const stays = next.state === "open" || next.state === "approved";
      const proposals = stays ? current.proposals.map((p) => (p.id === next.id ? next : p)) : current.proposals.filter((p) => p.id !== next.id);
      const total = stays ? current.total : current.total - 1;
      // The last one on this page was decided: read the page again, in case more are waiting on the next.
      reload = !stays && proposals.length === 0 && total > 0;
      return { ...current, proposals, total };
    });
    onChange?.();
    if (reload) queueMicrotask(() => read(true));
  }

  const items = open.kind === "ready" ? open.proposals : [];
  return (
    <>
      <PageHeader title="Proposals" description="Changes this app suggests to your Shopify stock. Nothing changes in Shopify until you press Approve." />

      <div className="mb-4 inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Show">
        {(["open", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => set({ tab: t === "history" ? "history" : undefined })}
            className="min-h-9 rounded-md px-4 text-sm font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {t === "open" ? "Waiting" : "History"}
          </button>
        ))}
      </div>

      {tab === "history" && <History api={api} params={params} />}

      {tab === "open" && (
        <>
          {(open.kind === "loading" || (open.kind === "ready" && items.length === 0 && open.total > 0)) && (
            <div className="flex flex-col gap-3">
              <p role="status" className="sr-only">
                Loading…
              </p>
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          )}
          {open.kind === "error" && (
            <div className="flex flex-col items-start gap-3">
              <Notice kind="error" role="alert">
                {open.message}
              </Notice>
              <Button onClick={() => read()}>Try again</Button>
            </div>
          )}
          {open.kind === "ready" && open.permission.state !== "ready" && (
            <div id="permission-notice" className="mb-4">
              <Notice kind="warning">{open.permission.message}</Notice>
            </div>
          )}
          {finished && (
            <div className="mb-4">
              <Notice kind="info" role="status">
                A suggestion you approved has finished. See History for the result.
              </Notice>
            </div>
          )}
          {open.kind === "ready" && items.length === 0 && open.total === 0 && (
            <Card>
              <EmptyState title="Nothing is waiting for you." description="New suggestions appear here after a supplier check finds a difference." />
            </Card>
          )}
          {open.kind === "ready" && items.length > 0 && (
            <ul className="flex flex-col gap-3">
              {items.map((p) => (
                <OpenItem key={p.id} api={api} proposal={p} permission={open.permission} onChanged={changed} />
              ))}
            </ul>
          )}
          {open.kind === "ready" && open.total > 0 && (
            <Card className="mt-4 overflow-hidden">
              <Pager page={page} pageSize={pageSize} total={open.total} onPage={(n) => set({ page: n })} onPageSize={(n) => set({ pageSize: n })} />
            </Card>
          )}
        </>
      )}
    </>
  );
}
