import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_QUANTITY } from "@stock-monitor/proposals";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Input, Select } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, Proposal, Supplier, WritePermission } from "../api.js";
import { DataTable, type Column } from "../components/DataTable.js";
import { BulkBar } from "../components/BulkBar.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SearchSelect } from "../components/SearchSelect.js";
import { deferred } from "../lib/deferred.js";
import { inTurn } from "../lib/inTurn.js";
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
type ItemProps = {
  api: Api;
  proposal: Proposal;
  permission: WritePermission;
  onChanged: (p: Proposal) => void;
  /** Reject goes through the page, which hides the row and offers Undo. */
  onReject: (p: Proposal) => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
  /** The number typed in Edit number, or null once editing is closed, so a bulk Approve uses what the row shows. */
  onText: (text: string | null) => void;
};

function OpenItem({ api, proposal, permission, onChanged, onReject, selected, onSelect, onText }: ItemProps) {
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

  const reject = () => {
    setError(null);
    onReject(proposal);
  };

  return (
    <li aria-label={name(proposal)} className={selected ? "flex gap-3 border-b border-rule-soft bg-selected px-2 py-4" : "flex gap-3 border-b border-rule-soft px-2 py-4"}>
      {!waiting ? (
        <input
          type="checkbox"
          aria-label={`Select ${name(proposal)}`}
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          className="mt-1 size-5 shrink-0 cursor-pointer accent-foreground lg:size-4"
        />
      ) : (
        <span className="w-5 shrink-0 lg:w-4" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
        <p className="font-mono text-base font-medium">Suggested: set to {waiting ? proposal.approvedQuantity : proposal.proposedQuantity}</p>
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
                  <Input
                    id={`qty-${proposal.id}`}
                    inputMode="numeric"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      onText(e.target.value);
                    }}
                    aria-invalid={error === NOT_A_NUMBER}
                  />
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
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={`Edit number for ${name(proposal)}`}
                  onClick={() => {
                    setEditing(true);
                    onText(text);
                  }}
                >
                  Edit number
                </Button>
              )}
              <Button variant="outline" disabled={busy} aria-label={`Reject ${name(proposal)}`} onClick={reject}>
                Reject
              </Button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

const REFRESHABLE = new Set(["conflict", "failed", "expired"]);

function History({ api, params, supplierId, supplierName }: { api: Api; params: ListParams; supplierId: string; supplierName: string | undefined }) {
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
    (supplierId ? api.proposals.history(page, pageSize, supplierId) : api.proposals.history(page, pageSize))
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
  }, [api, page, pageSize, supplierId]);
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
          empty={<EmptyState title={supplierName ? `No past suggestions for ${supplierName} yet.` : "No past suggestions yet."} />}
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
  const { page, pageSize, sort, dir, set } = params;
  const tab = params.filters.tab === "history" ? "history" : "open";
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersRead, setSuppliersRead] = useState(false);
  const [waitingCounts, setWaitingCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    api.suppliers
      .list()
      .then((list) => {
        setSuppliers(list);
        setSuppliersRead(true);
      })
      .catch(() => {});
  }, [api]);
  // A supplier in the address that is not in the list (deleted, or mistyped) shows everything.
  const wanted = params.filters.supplier ?? "";
  const supplierId = suppliersRead && !suppliers.some((s) => s.id === wanted) ? "" : wanted;
  const readCounts = useCallback(() => void api.proposals.waitingBySupplier().then(setWaitingCounts).catch(() => {}), [api]);
  const supplierName = suppliers.find((s) => s.id === supplierId)?.name;
  const [open, setOpen] = useState<Open>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Rejected with Undo still waiting: hidden at once, back on Undo or if the reject fails.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const texts = useRef(new Map<string, string>());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [finished, setFinished] = useState(false);
  const waitingIds = useRef<Set<string>>(new Set());
  const latest = useRef(0);

  const read = useCallback(
    (quiet = false) => {
      const mine = ++latest.current;
      if (!quiet) setOpen({ kind: "loading" });
      api.proposals
        .openPage({ page, pageSize, ...(supplierId ? { supplierId } : {}), ...(sort ? { sort, dir } : {}) })
        .then((r) => {
          if (mine !== latest.current) return; // a newer read was asked for since
          // One that was waiting for Shopify and has gone has finished: its result is in History.
          if ([...waitingIds.current].some((id) => !r.items.some((p) => p.id === id))) setFinished(true);
          waitingIds.current = new Set(r.items.filter((p) => p.state === "approved").map((p) => p.id));
          setOpen({ kind: "ready", proposals: r.items, total: r.total, permission: r.writePermission });
          onChange?.();
        })
        .catch((e: unknown) => {
          if (mine === latest.current && !quiet) setOpen({ kind: "error", message: message(e) });
        });
      readCounts();
    },
    [api, onChange, page, pageSize, supplierId, sort, dir, readCounts],
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
    readCounts();
    if (reload) queueMicrotask(() => read(true));
  }

  const items = open.kind === "ready" ? open.proposals.filter((p) => !hidden.has(p.id)) : [];
  const selectable = items.filter((p) => p.state === "open");
  const ticked = selectable.filter((p) => selected.has(p.id));
  const allTicked = selectable.length > 0 && ticked.length === selectable.length;
  const select = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const show = (ids: string[]) => setHidden((h) => new Set([...h].filter((x) => !ids.includes(x))));
  /** The number a row shows: the owner's edit when it differs from the suggestion, else none (the suggestion is used). */
  const quantityOf = (p: Proposal) => {
    const text = texts.current.get(p.id);
    if (text === undefined) return undefined;
    if (!/^\d+$/.test(text.trim()) || Number(text) > MAX_QUANTITY) throw new Error(NOT_A_NUMBER);
    return Number(text) === p.proposedQuantity ? undefined : Number(text);
  };
  const approveTicked = async () => {
    const list = ticked;
    const failed = await inTurn(list, async (p) => changed(await api.proposals.approve(p.id, quantityOf(p))), (done, total) => setBulk({ done, total }));
    setBulk(null);
    setSelected(new Set());
    if (failed.length) toast(failed.map((f) => `${f.item.productTitle}: ${f.message}`).join(" "), { kind: "error" });
    else toast(`Approved ${list.length}. Shopify will be updated for each.`);
  };
  const rejectMany = (list: Proposal[]) => {
    const ids = list.map((p) => p.id);
    setHidden((h) => new Set([...h, ...ids]));
    setSelected((cur) => new Set([...cur].filter((x) => !ids.includes(x))));
    deferred({
      text: list.length === 1 ? `Rejected ${name(list[0]!)}.` : `${list.length} proposals rejected.`,
      commit: async (keepalive) => {
        const one = async (p: Proposal) => changed(await api.proposals.reject(p.id, { keepalive }));
        // While the page closes there is no time to wait for each answer: send them all at once, each kept alive by the browser.
        const failed = keepalive
          ? (await Promise.allSettled(list.map(one))).flatMap((r, i) => (r.status === "rejected" ? [{ item: list[i]!, message: r.reason instanceof Error ? r.reason.message : String(r.reason) }] : []))
          : await inTurn(list, one, () => {});
        show(ids);
        read(true); // what is left on this page, or the next page's suggestions when this one is now empty
        if (failed.length) throw new Error(failed.map((f) => `${f.item.productTitle}: ${f.message}`).join(" "));
      },
      onUndo: () => show(ids),
      onFailed: () => show(ids),
    });
  };
  return (
    <>
      <PageHeader title="Proposals" description="Changes this app suggests to your Shopify stock. Nothing changes in Shopify until you press Approve." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Show">
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
        <SearchSelect
          label="Supplier"
          value={supplierId || null}
          options={suppliers.map((s) => ({ id: s.id, label: s.name, count: tab === "open" ? (waitingCounts[s.id] ?? 0) : undefined }))}
          allOption={{ id: "", label: "All suppliers" }}
          placeholder="Search suppliers"
          noMatch={(text) => `No supplier matches "${text}".`}
          onChange={(id) => set({ supplier: id ?? undefined })}
        />
        {tab === "open" && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground lg:text-[0.8125rem]">
            Sort
            <Select value={sort ?? ""} onChange={(e) => set({ sort: e.target.value || undefined, dir: undefined })}>
              <option value="">Newest first</option>
              <option value="product">Product A to Z</option>
              <option value="supplier">Supplier A to Z</option>
            </Select>
          </label>
        )}
      </div>

      {tab === "history" && <History api={api} params={params} supplierId={supplierId} supplierName={supplierName} />}

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
            <EmptyState title={supplierName ? `Nothing is waiting for ${supplierName}.` : "Nothing is waiting for you."} description="New suggestions appear here after a supplier check finds a difference." />
          )}
          {ticked.length > 0 && open.kind === "ready" && (
            <BulkBar
              count={ticked.length}
              canApprove={open.permission.state === "ready"}
              onApprove={() => setConfirmApprove(true)}
              onReject={() => rejectMany(ticked)}
              onClear={() => setSelected(new Set())}
              progress={bulk}
            />
          )}
          {open.kind === "ready" && items.length > 0 && (
            <>
              {selectable.length > 0 && (
                <label className="flex items-center gap-3 border-b border-foreground px-2 pb-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allTicked}
                    ref={(el) => {
                      if (el) el.indeterminate = ticked.length > 0 && !allTicked;
                    }}
                    onChange={() => setSelected(allTicked ? new Set() : new Set(selectable.map((p) => p.id)))}
                    className="size-5 cursor-pointer accent-foreground lg:size-4"
                  />
                  Select all on this page
                </label>
              )}
              <ul className="flex flex-col">
                {items.map((p) => (
                  <OpenItem
                    key={p.id}
                    api={api}
                    proposal={p}
                    permission={open.permission}
                    onChanged={changed}
                    onReject={(x) => rejectMany([x])}
                    selected={selected.has(p.id)}
                    onSelect={(on) => select(p.id, on)}
                    onText={(t) => (t === null ? texts.current.delete(p.id) : texts.current.set(p.id, t))}
                  />
                ))}
              </ul>
            </>
          )}
          {confirmApprove && (
            <ConfirmDialog
              open
              tone="default"
              title={`Approve ${ticked.length} changes?`}
              description="Shopify will be updated for each."
              confirmLabel={`Approve ${ticked.length}`}
              onConfirm={approveTicked}
              onClose={() => setConfirmApprove(false)}
            />
          )}
          {open.kind === "ready" && open.total > 0 && (
            <div className="mt-2">
              <Pager page={page} pageSize={pageSize} total={open.total} onPage={(n) => set({ page: n })} onPageSize={(n) => set({ pageSize: n })} />
            </div>
          )}
        </>
      )}
    </>
  );
}
