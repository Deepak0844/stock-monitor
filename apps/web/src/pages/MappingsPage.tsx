import { useCallback, useEffect, useRef, useState } from "react";
import { Download, History, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { isStale } from "@stock-monitor/scheduling";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.js";
import { Input, Select } from "@/components/ui/input.js";
import { Tip } from "@/components/ui/tooltip.js";
import { CopyButton } from "../components/CopyButton.js";
import { FilterChips } from "../components/FilterChips.js";
import { SearchSelect } from "../components/SearchSelect.js";
import { When } from "../components/When.js";
import { deferred } from "../lib/deferred.js";
import type { Api, CheckRun, LinkStatus, Mapping, Observation, StartedRun, StockFilter, Supplier, UnmappedList } from "../api.js";
import { DataTable, type Column } from "../components/DataTable.js";
import { EmptyState } from "../components/EmptyState.js";
import { LINK_STATUS_OPTIONS, linkStatusOf } from "../components/linkStatus.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { Pager } from "../components/Pager.js";
import { suggestionLine } from "../components/proposalWords.js";
import { runSummary } from "../components/scheduleWords.js";
import { ANSWER_TONE, ANSWER_WORDS, reasonWords, stockSentence } from "../components/stockWords.js";
import { badgeVariant } from "../components/tone.js";
import { formatDay, formatWhen } from "../format.js";
import { useListParams } from "../lib/useListParams.js";
import { useWatch, WATCH_MS } from "../lib/useWatch.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";
import { toast } from "../lib/toast.js";

const SHOW_UNMAPPED = 50;
const SEARCH_DELAY_MS = 300;
// A check finishes some moments after it is asked for (a login can take a minute), so that one link is read again for up to 2 minutes.
const CHECK_READS = 40;
/** Checks of single rows still going are kept for this tab, so leaving the page and coming back keeps their spinners. */
type Pending = { key: string; id: string; kind: "link" | "stock"; baseline: string | null; at: number };
const PENDING_KEY = "pending-row-checks";
const PENDING_MAX_MS = CHECK_READS * WATCH_MS;
function readPending(): Pending[] {
  try {
    const all = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]") as Pending[];
    return all.filter((p) => Date.now() - p.at < PENDING_MAX_MS);
  } catch {
    return [];
  }
}
function writePending(list: Pending[]) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // Without storage the spinner is simply lost on leaving, as before.
  }
}
const forgetPending = (key: string) => writePending(readPending().filter((p) => p.key !== key));
/** Saves one row's check, once per row and kind. */
const remember = (p: Pending) => writePending([...readPending().filter((x) => x.key !== p.key), p]);
const STOCK_OPTIONS: { value: StockFilter; words: string }[] = [
  { value: "in_stock", words: ANSWER_WORDS.in_stock },
  { value: "out_of_stock", words: ANSWER_WORDS.out_of_stock },
  { value: "cannot_tell", words: ANSWER_WORDS.cannot_tell },
  { value: "none", words: "No stock check yet" },
];
// A whole supplier run is followed through its own small status, not by reading the list again.
const RUN_POLL_MS = 3000;

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
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
  const params = useListParams({ pageSize: 10 });
  const { page, pageSize, search, sort, dir, set } = params;
  const supplierId = params.filters.supplier ?? "";
  const status = (LINK_STATUS_OPTIONS.some((o) => o.value === params.filters.status) ? params.filters.status : "") as LinkStatus | "";
  const stock = (STOCK_OPTIONS.some((o) => o.value === params.filters.stock) ? params.filters.stock : "") as StockFilter | "";
  const filtered = supplierId !== "" || status !== "" || stock !== "" || search !== "";

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [data, setData] = useState<{ items: Mapping[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Links deleted with Undo still waiting: hidden at once, back again on Undo or if the delete fails.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [q, setQ] = useState(search);
  const [variantSearch, setVariantSearch] = useState("");
  const [unmapped, setUnmapped] = useState<UnmappedList | null>(null);
  const [reloaded, setReloaded] = useState(0);
  // Checks asked for whose answer has not shown yet, as `link:<id>` or `stock:<id>`.
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  const stopWaiting = (key?: string) => key && setWaiting((w) => (w.has(key) ? new Set([...w].filter((x) => x !== key)) : w));
  const [history, setHistory] = useState<{ mapping: Mapping; items: Observation[] } | null>(null);
  const vq = useDelayed(variantSearch);
  const latestCall = useRef(0);

  useEffect(() => {
    api.suppliers.list().then(setSuppliers).catch(() => {});
  }, [api]);

  const load = useCallback(() => {
    const mine = ++latestCall.current;
    setLoading(true);
    setLoadError(null);
    api.mappings
      .page({ supplierId: supplierId || undefined, status: status || undefined, stock: stock || undefined, search: search || undefined, page, pageSize, ...(sort ? { sort, dir } : {}) })
      .then((result) => {
        if (mine !== latestCall.current) return;
        setData({ items: result.items, total: result.total });
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (mine !== latestCall.current) return;
        setLoadError(message(e));
        setLoading(false);
      });
  }, [api, supplierId, status, stock, search, page, pageSize, sort, dir]);
  useEffect(load, [load]);

  // The search box waits for a pause in typing, then goes to the address. A change made elsewhere, such as clearing, comes back in.
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => set({ search: q }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q, search, set]);
  useEffect(() => setQ(search), [search]);

  // A check of one link is followed through the link's small status. Once it says the check finished, that link is read once and
  // only its row changes.
  const watch = useWatch();
  const replaceRow = (m: Mapping) => setData((d) => d && { ...d, items: d.items.map((x) => (x.id === m.id ? m : x)) });
  const follow = async (key: string, m: { id: string }, finished: (s: { linkCheckedAt: string | null; stockCheckedAt: string | null }) => boolean, reads = CHECK_READS) => {
    try {
      if (await watch(key, reads, () => api.mappings.status(m.id), finished)) replaceRow(await api.mappings.get(m.id));
    } catch {
      // The row keeps what it showed; the next page load brings the answer.
    } finally {
      forgetPending(key);
      stopWaiting(key);
    }
  };
  // Back on the page: a check started before leaving is looked at once. If it already finished its row is read; if not, its
  // spinner returns and it is followed again.
  useEffect(() => {
    for (const p of readPending()) {
      const finished = (st: { linkCheckedAt: string | null; stockCheckedAt: string | null }) => (p.kind === "link" ? st.linkCheckedAt : st.stockCheckedAt) !== p.baseline;
      api.mappings
        .status(p.id)
        .then(async (st) => {
          if (finished(st)) {
            forgetPending(p.key);
            replaceRow(await api.mappings.get(p.id));
          } else {
            setWaiting((w) => new Set(w).add(p.key));
            void follow(p.key, { id: p.id }, finished, Math.max(1, Math.ceil((PENDING_MAX_MS - (Date.now() - p.at)) / WATCH_MS))); // only the reads it had left
          }
        })
        .catch(() => forgetPending(p.key));
    }
  }, []);

  // The chosen supplier's whole run: one going when the page opens or the supplier is chosen, or one just started here.
  const [wholeRun, setWholeRun] = useState<CheckRun | null>(null);
  const running = wholeRun?.outcome === "running";
  useEffect(() => setWholeRun(null), [supplierId]);
  useEffect(() => {
    // No supplier chosen: look at every supplier, so a run started earlier still shows after coming back.
    const ids = supplierId ? [supplierId] : suppliers.map((s) => s.id);
    if (ids.length === 0) return;
    let live = true;
    Promise.all(ids.map((id) => api.schedule.currentRun(id).catch(() => null))).then((runs) => {
      const found = runs.find(Boolean) ?? null; // the server only answers with runs still going
      if (live && found) setWholeRun((cur) => cur ?? found);
    });
    return () => void (live = false);
  }, [api, supplierId, suppliers]);
  // While it runs, its status is asked for every few seconds. When it ends the list is read once, for the new answers.
  useEffect(() => {
    if (!wholeRun || wholeRun.outcome !== "running") return;
    const timer = setTimeout(() => {
      api.schedule
        .run(wholeRun.id)
        .then((next) => {
          setWholeRun((cur) => (cur?.id === next.id ? next : cur));
          if (next.outcome !== "running") load();
        })
        .catch(() => setWholeRun((cur) => (cur?.id === wholeRun.id ? { ...cur } : cur))); // a new object asks again after the pause
    }, RUN_POLL_MS);
    return () => clearTimeout(timer);
  }, [api, wholeRun, load]);

  useEffect(() => {
    api.mappings.unmapped(vq || undefined).then(setUnmapped).catch(() => setUnmapped(null));
  }, [api, vq, reloaded]);

  async function run(key: string, work: () => Promise<void>) {
    setBusyKey(key);
    setActionError(null);
    try {
      await work();
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusyKey(null);
    }
  }
  const busy = busyKey !== null;

  const label = (m: Mapping) => `${m.productTitle} ${m.variantTitle}`;
  const checkOne = (m: Mapping) =>
    run(`link:${m.id}`, async () => {
      setWaiting((w) => new Set(w).add(`link:${m.id}`));
      try {
        await api.mappings.checkLink(m.id);
      } catch (e) {
        stopWaiting(`link:${m.id}`);
        throw e;
      }
      remember({ key: `link:${m.id}`, id: m.id, kind: "link", baseline: m.lastLinkCheckAt, at: Date.now() });
      void follow(`link:${m.id}`, m, (s) => s.linkCheckedAt !== m.lastLinkCheckAt);
      toast(`A check of ${m.productTitle} (${m.variantTitle}) has started. Its status will update in a moment.`);
    });
  const checkStock = (m: Mapping) =>
    run(`stock:${m.id}`, async () => {
      setWaiting((w) => new Set(w).add(`stock:${m.id}`));
      try {
        await api.stock.checkLink(m.id);
      } catch (e) {
        stopWaiting(`stock:${m.id}`);
        throw e;
      }
      remember({ key: `stock:${m.id}`, id: m.id, kind: "stock", baseline: m.latestStock?.observedAt ?? null, at: Date.now() });
      void follow(`stock:${m.id}`, m, (s) => s.stockCheckedAt !== (m.latestStock?.observedAt ?? null));
      toast(`A stock check of ${m.productTitle} (${m.variantTitle}) has started. The answer will appear here in a moment.`);
    });
  const supplier = suppliers.find((s) => s.id === supplierId);
  const runSupplier = wholeRun && suppliers.find((s) => s.id === wholeRun.supplierId);
  /** Starts a whole supplier run and follows it in the progress bar. */
  const startRun = (key: string, s: Supplier, start: () => Promise<StartedRun>, words: (links: string) => string) =>
    run(key, async () => {
      const { links, runId } = await start();
      const now = new Date().toISOString();
      setWholeRun({ id: runId, supplierId: s.id, trigger: "manual", kind: key === "all-links" ? "links" : "stock", startedAt: now, endedAt: null, linksTotal: links, linksDone: 0, inStock: 0, outOfStock: 0, cannotTell: 0, outcome: "running", stopReason: null });
      toast(words(`${links} ${links === 1 ? "link" : "links"}`));
    });
  const checkAllStock = (s: Supplier) =>
    startRun("all-stock", s, () => api.stock.checkSupplier(s.id), (n) => `Checking stock for ${n} for ${s.name}, one page at a time. The answers appear when the run ends.`);
  const checkAll = (s: Supplier) =>
    startRun("all-links", s, () => api.mappings.checkSupplierLinks(s.id), (n) => `Checking ${n} for ${s.name}, one page at a time. The statuses update when the run ends.`);
  const toggleHistory = (m: Mapping) =>
    run(`history:${m.id}`, async () => {
      if (history?.mapping.id === m.id) return setHistory(null);
      setHistory({ mapping: m, items: await api.stock.observations(m.id) });
    });
  const show = (id: string) => setHidden((h) => new Set([...h].filter((x) => x !== id)));
  const remove = (m: Mapping) => {
    setHidden((h) => new Set(h).add(m.id));
    deferred({
      text: `Deleted the link for ${m.productTitle} (${m.variantTitle}).`,
      commit: async (keepalive) => {
        await api.mappings.remove(m.id, { keepalive });
        show(m.id);
        setReloaded((n) => n + 1); // its variant now has no link
        load();
      },
      onUndo: () => show(m.id),
      onFailed: () => show(m.id),
    });
  };
  const sortBy = (key: string) => set({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc" });

  const confirmedEmpty = data !== null && data.total === 0 && !filtered;
  // A page past the end, for example after deleting its last row, is read again from the last page, so show it as loading.
  const rows = data === null || (data.items.length === 0 && data.total > 0) ? null : data.items.filter((m) => !hidden.has(m.id));
  const stockRegion = (m: Mapping) => m.region ?? suppliers.find((x) => x.id === m.supplierId)?.defaultRegion;

  const columns: Column<Mapping>[] = [
    {
      header: "Product",
      sortKey: "product",
      cell: (m) => (
        <>
          <span className="font-semibold">{m.productTitle}</span>
          <div className="text-muted-foreground">
            {m.variantTitle}
            {m.sku && (
              <>
                {" · "}
                <span className="font-mono">{m.sku}</span> <CopyButton value={m.sku} label="SKU" />
              </>
            )}
          </div>
          {m.variantRemoved && <div className="text-muted-foreground">Variant removed in Shopify</div>}
        </>
      ),
    },
    { header: "Supplier", sortKey: "supplier", cell: (m) => m.supplierName },
    {
      header: "Page",
      cell: (m) => (
        <span className="flex items-center gap-1">
          <Tip label={m.url}>
            <span tabIndex={0} className="block max-w-[14rem] truncate font-mono text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
              {where(m.url)}
            </span>
          </Tip>
          <CopyButton value={m.url} label="supplier page" />
        </span>
      ),
    },
    {
      header: "Status",
      cell: (m) => {
        const s = linkStatusOf(m);
        // While a check runs only the first line changes, so the row keeps its size.
        return (
          <div className="flex flex-col items-start gap-1">
            {waiting.has(`link:${m.id}`) ? (
              <Badge variant="warning" className="animate-pulse">
                Checking…
              </Badge>
            ) : (
              <Badge variant={badgeVariant(s.tone)}>{s.words}</Badge>
            )}
            {m.unavailableCandidate && <Badge variant="warning">May be unavailable</Badge>}
            {s.hint && <span className="text-muted-foreground">{s.hint}</span>}
            {m.linkStatus === "page_missing" && m.lastWorkedAt && <span className="text-muted-foreground">Worked until {formatDay(m.lastWorkedAt)}</span>}
          </div>
        );
      },
    },
    {
      header: "Stock",
      cell: (m) =>
        m.latestStock ? (
          <div className="flex flex-col items-start gap-1">
            {waiting.has(`stock:${m.id}`) ? (
              <Badge variant="warning" className="animate-pulse">
                Checking…
              </Badge>
            ) : (
              <Badge variant={badgeVariant(ANSWER_TONE[m.latestStock.answer])}>{stockSentence(m.latestStock, stockRegion(m))}</Badge>
            )}
            {reasonWords(m.latestStock.reason) && m.latestStock.reason !== "not_listed" && <span className="text-muted-foreground">{reasonWords(m.latestStock.reason)}</span>}
            {m.latestStock.reason === "page_changed" && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/suppliers/${m.supplierId}/rules`}>Review stock rules</Link>
              </Button>
            )}
            <span className="text-muted-foreground">Seen {formatWhen(m.latestStock.observedAt)}</span>
            {m.latestSuggestion && (
              <Link to="/proposals" className="underline">
                {suggestionLine(m.latestSuggestion.kind, m.latestSuggestion.state)}
              </Link>
            )}
          </div>
        ) : waiting.has(`stock:${m.id}`) ? (
          <Badge variant="warning" className="animate-pulse">
            Checking…
          </Badge>
        ) : (
          <span className="text-muted-foreground">No stock check yet</span>
        ),
    },
    {
      header: "Last checked",
      sortKey: "lastChecked",
      cell: (m) => (
        <div className="flex flex-col items-start gap-1">
          {m.lastLinkCheckAt ? <When at={m.lastLinkCheckAt} /> : <span className="text-muted-foreground">Never</span>}
          {isStale(m.lastLinkCheckAt ? new Date(m.lastLinkCheckAt) : null, suppliers.find((x) => x.id === m.supplierId)?.scheduleIntervalMinutes ?? null, new Date()) && (
            <Badge variant="warning">Not checked recently</Badge>
          )}
        </div>
      ),
    },
    {
      header: "Actions",
      hideHeader: true,
      className: "text-right",
      cell: (m) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy || !m.enabled} loading={busyKey === `link:${m.id}`} aria-label={`Check now ${label(m)}`} onClick={() => void checkOne(m)}>
            Check now
          </Button>
          <Button variant="outline" size="sm" disabled={busy || !m.enabled} loading={busyKey === `stock:${m.id}`} aria-label={`Check stock ${label(m)}`} onClick={() => void checkStock(m)}>
            Check stock
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-9" aria-label={`More actions for ${label(m)}`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => void toggleHistory(m)}>
                <History aria-hidden="true" />
                {history?.mapping.id === m.id ? "Hide history" : "History"}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/mappings/${m.id}/edit`}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-danger" onSelect={() => remove(m)}>
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Links"
        description="Which supplier page each of your Shopify variants matches."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/mappings/import">Import from Shopify export</Link>
            </Button>
            <Button asChild>
              <Link to="/mappings/new">
                <Plus aria-hidden="true" />
                Add link
              </Link>
            </Button>
          </>
        }
      />

      {actionError && (
        <div className="mb-4">
          <Notice kind="error" role="alert">
            {actionError}
          </Notice>
        </div>
      )}
      {loading && data === null && !loadError && (
        <p role="status" className="sr-only">
          Loading links…
        </p>
      )}

      <div className="min-w-0">
        {!confirmedEmpty && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
            <Input type="search" aria-label="Search links" placeholder="Search by product, variant or SKU" autoComplete="off" className="min-w-48 flex-1" value={q} onChange={(e) => setQ(e.target.value)} />
            <SearchSelect
              label="Supplier"
              value={supplierId || null}
              options={suppliers.map((s) => ({ id: s.id, label: s.name, detail: host(s.websiteUrl) }))}
              allOption={{ id: "", label: "All suppliers" }}
              placeholder="Search suppliers"
              noMatch={(text) => `No supplier matches "${text}".`}
              onChange={(id) => set({ supplier: id ?? undefined })}
            />
            <Select aria-label="Link status" value={status} onChange={(e) => set({ status: e.target.value || undefined })}>
              <option value="">Any status</option>
              {LINK_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.words}
                </option>
              ))}
            </Select>
            <Select aria-label="Stock answer" value={stock} onChange={(e) => set({ stock: e.target.value || undefined })}>
              <option value="">Any stock answer</option>
              {STOCK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.words}
                </option>
              ))}
            </Select>
            {supplier && (
              <>
                <Button variant="outline" disabled={busy || running} loading={busyKey === "all-links"} onClick={() => void checkAll(supplier)}>
                  Check all links for {supplier.name}
                </Button>
                <Button variant="outline" disabled={busy || running} loading={busyKey === "all-stock"} onClick={() => void checkAllStock(supplier)}>
                  Check all stock for {supplier.name}
                </Button>
              </>
            )}
          </div>
        )}
        <FilterChips
          chips={[
            ...(search ? [{ key: "search", label: "Search", value: `"${search}"`, onRemove: () => set({ search: undefined }) }] : []),
            ...(supplierId ? [{ key: "supplier", label: "Supplier", value: suppliers.find((x) => x.id === supplierId)?.name ?? "One supplier", onRemove: () => set({ supplier: undefined }) }] : []),
            ...(status ? [{ key: "status", label: "Status", value: LINK_STATUS_OPTIONS.find((o) => o.value === status)!.words, onRemove: () => set({ status: undefined }) }] : []),
            ...(stock ? [{ key: "stock", label: "Stock", value: STOCK_OPTIONS.find((o) => o.value === stock)!.words, onRemove: () => set({ stock: undefined }) }] : []),
          ]}
          onClearAll={() => set({ search: undefined, supplier: undefined, status: undefined, stock: undefined })}
        />
        {wholeRun && runSupplier && <RunProgress run={wholeRun} supplierName={runSupplier.name} />}
        <DataTable
          label="Links"
          columns={columns}
          sort={sort ? { key: sort, dir } : null}
          onSort={sortBy}
          rows={rows}
          rowKey={(m) => m.id}
          loading={loading}
          error={loadError}
          onRetry={load}
          pageSize={pageSize}
          empty={
            confirmedEmpty ? (
              <EmptyState
                title="No links yet. Add one by hand, or import them from your Shopify export."
                description="A link says which supplier page a Shopify variant matches, so its stock can be checked."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button asChild>
                      <Link to="/mappings/new">
                        <Plus aria-hidden="true" />
                        Add link
                      </Link>
                    </Button>
                    <Button variant="outline" asChild>
                      <Link to="/mappings/import">Import from Shopify export</Link>
                    </Button>
                  </div>
                }
              />
            ) : (
              <EmptyState
                title="No links match those filters."
                action={
                  <Button variant="outline" onClick={() => set({ search: undefined, supplier: undefined, status: undefined, stock: undefined })}>
                    Clear filters
                  </Button>
                }
              />
            )
          }
        />
        {data !== null && data.total > 0 && <Pager page={page} pageSize={pageSize} total={data.total} onPage={(n) => set({ page: n })} onPageSize={(n) => set({ pageSize: n })} />}
      </div>

      {history && (
        <section className="mt-8 border-t border-border pt-4">
          <h3 className="mb-2 text-base font-semibold">Stock history for {label(history.mapping)}</h3>
          {history.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock checks yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm" aria-label={`Stock history for ${label(history.mapping)}`}>
              {history.items.map((o) => (
                <li key={o.id} className="border-b border-border pb-2 last:border-b-0">
                  <strong>{stockSentence(o, history.mapping.region)}</strong> · {formatWhen(o.observedAt)}
                  {o.recipeVersion === 0 ? " · built-in data, no stock rules" : o.recipeVersion !== null ? ` · rules version ${o.recipeVersion}` : ""}
                  {o.readBy === "quick" ? " · Read quickly" : o.readBy === "browser" ? " · Read with the browser" : ""}
                  {reasonWords(o.reason) && o.reason !== "not_listed" ? ` · ${reasonWords(o.reason)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {unmapped && (
        <section className="mt-8 border-t border-border pt-4" aria-labelledby="unmapped-heading">
          <h2 id="unmapped-heading" className="mb-2 text-base font-semibold">
            Variants with no link
          </h2>
          {unmapped.unmapped === 0 && !vq ? (
            <p className="text-sm text-muted-foreground">Every variant has a link.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  {unmapped.unmapped} of {unmapped.total} variants are not mapped
                </p>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/variants/unmapped.csv${vq ? `?${new URLSearchParams({ search: vq })}` : ""}`} download>
                    <Download aria-hidden="true" />
                    Download CSV
                  </a>
                </Button>
              </div>
              <Input id="variant-search" type="search" aria-label="Search variants with no link" placeholder="Search variants with no link" autoComplete="off" className="mb-3 max-w-md" value={variantSearch} onChange={(e) => setVariantSearch(e.target.value)} />
              <ul className="flex flex-col">
                {unmapped.items.slice(0, SHOW_UNMAPPED).map((v) => (
                  <li key={v.variantId} className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm">
                    <span className="min-w-0">
                      {v.productTitle} · {v.variantTitle}
                      {v.sku ? ` · ${v.sku}` : ""}
                    </span>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/mappings/new?variant=${encodeURIComponent(v.variantId)}`} aria-label={`Map ${v.productTitle} ${v.variantTitle}`}>
                        Map
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
              {unmapped.items.length > SHOW_UNMAPPED && <p className="mt-2 text-sm text-muted-foreground">Showing the first {SHOW_UNMAPPED}. Search to narrow the list.</p>}
            </>
          )}
        </section>
      )}

    </>
  );
}

/** How far the chosen supplier's whole run is, or how it ended. */
function RunProgress({ run, supplierName }: { run: CheckRun; supplierName: string }) {
  const what = `${run.kind === "links" ? "Link check" : "Stock check"} for ${supplierName}`;
  const share = run.linksTotal > 0 ? run.linksDone / run.linksTotal : 0;
  const tone = run.outcome === "running" || run.outcome === "finished" ? "text-muted-foreground" : "text-danger";
  return (
    <div className="border-b border-border p-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold">{what}</span>
        <span className={tone}>{runSummary(run)}</span>
      </div>
      {run.outcome === "running" && (
        <div role="progressbar" aria-label={what} aria-valuemin={0} aria-valuemax={run.linksTotal} aria-valuenow={run.linksDone} className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `scaleX(${share})` }} />
        </div>
      )}
    </div>
  );
}
