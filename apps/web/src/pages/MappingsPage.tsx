import { useCallback, useEffect, useRef, useState } from "react";
import { History, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { isStale } from "@stock-monitor/scheduling";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.js";
import { Input, Select } from "@/components/ui/input.js";
import type { Api, LinkStatus, Mapping, Observation, Supplier, UnmappedList } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DataTable, type Column } from "../components/DataTable.js";
import { EmptyState } from "../components/EmptyState.js";
import { LINK_STATUS_OPTIONS, linkStatusOf } from "../components/linkStatus.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { Pager } from "../components/Pager.js";
import { suggestionLine } from "../components/proposalWords.js";
import { ANSWER_TONE, reasonWords, stockSentence } from "../components/stockWords.js";
import { badgeVariant } from "../components/tone.js";
import { formatDay, formatWhen } from "../format.js";
import { useListParams } from "../lib/useListParams.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const SHOW_UNMAPPED = 50;
const SEARCH_DELAY_MS = 300;
// A check finishes some moments after it is asked for (a login-browser check takes up to half a minute), so the list is read again.
const CHECK_REFRESH_MS = 4000;
const CHECK_REFRESHES = 12;
// A whole supplier run takes as long as its pauses, so it is followed longer and stops after this many unchanged reads.
const RUN_REFRESHES = 60;
const STILL_POLLS = 3;

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
  const params = useListParams({ pageSize: 10 });
  const { page, pageSize, search, set } = params;
  const supplierId = params.filters.supplier ?? "";
  const status = (LINK_STATUS_OPTIONS.some((o) => o.value === params.filters.status) ? params.filters.status : "") as LinkStatus | "";
  const filtered = supplierId !== "" || status !== "" || search !== "";

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [data, setData] = useState<{ items: Mapping[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Mapping | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [q, setQ] = useState(search);
  const [variantSearch, setVariantSearch] = useState("");
  const [unmapped, setUnmapped] = useState<UnmappedList | null>(null);
  const [reloaded, setReloaded] = useState(0);
  const [history, setHistory] = useState<{ mapping: Mapping; items: Observation[] } | null>(null);
  const vq = useDelayed(variantSearch);
  const query = { supplierId: supplierId || undefined, status: status || undefined, search: search || undefined, page, pageSize };
  const queryRef = useRef(query);
  queryRef.current = query;
  const latestCall = useRef(0);

  useEffect(() => {
    api.suppliers.list().then(setSuppliers).catch(() => {});
  }, [api]);

  const load = useCallback(() => {
    const mine = ++latestCall.current;
    setLoading(true);
    setLoadError(null);
    api.mappings
      .page({ supplierId: supplierId || undefined, status: status || undefined, search: search || undefined, page, pageSize })
      .then((result) => {
        if (mine !== latestCall.current) return;
        setData({ items: result.items, total: result.total });
        setLoading(false);
        setReloaded((n) => n + 1);
      })
      .catch((e: unknown) => {
        if (mine !== latestCall.current) return;
        setLoadError(message(e));
        setLoading(false);
      });
  }, [api, supplierId, status, search, page, pageSize]);
  useEffect(load, [load]);

  // The search box waits for a pause in typing, then goes to the address. A change made elsewhere, such as clearing, comes back in.
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => set({ search: q }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q, search, set]);
  useEffect(() => setQ(search), [search]);

  // A check finishes some moments after it is asked for, so the page is read again until the answer shows. It stops as soon as it
  // does, and never sets the list again when nothing changed (which would also re-read the unmapped variants).
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Mapping[] | null>(null);
  latest.current = data?.items ?? null;
  useEffect(() => () => void (refreshTimer.current && clearTimeout(refreshTimer.current)), []);
  /** `finished` says when the answer has shown. Without it (a whole supplier run) it stops once the list has changed and then sat still. */
  const refreshSoon = (times: number, finished?: (list: Mapping[]) => boolean, sawChange = false, still = 0) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      api.mappings
        .page(queryRef.current)
        .then((result) => {
          const changed = JSON.stringify(result.items) !== JSON.stringify(latest.current);
          if (changed) setData({ items: result.items, total: result.total });
          const stop = finished ? finished(result.items) : sawChange && !changed && still + 1 >= STILL_POLLS;
          if (!stop && times > 1) refreshSoon(times - 1, finished, sawChange || changed, changed ? 0 : still + 1);
        })
        .catch(() => {});
    }, CHECK_REFRESH_MS);
  };

  useEffect(() => {
    api.mappings.unmapped(vq || undefined).then(setUnmapped).catch(() => setUnmapped(null));
  }, [api, vq, reloaded]);

  async function run(key: string, work: () => Promise<void>) {
    setBusyKey(key);
    setActionError(null);
    setDone(null);
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
      await api.mappings.checkLink(m.id);
      refreshSoon(CHECK_REFRESHES, (list) => list.find((x) => x.id === m.id)?.lastLinkCheckAt !== m.lastLinkCheckAt);
      setDone(`A check of ${m.productTitle} (${m.variantTitle}) has started. Its status will update in a moment.`);
    });
  const checkStock = (m: Mapping) =>
    run(`stock:${m.id}`, async () => {
      await api.stock.checkLink(m.id);
      refreshSoon(CHECK_REFRESHES, (list) => list.find((x) => x.id === m.id)?.latestStock?.observedAt !== m.latestStock?.observedAt);
      setDone(`A stock check of ${m.productTitle} (${m.variantTitle}) has started. The answer will appear here in a moment.`);
    });
  const supplier = suppliers.find((s) => s.id === supplierId);
  const checkAllStock = (s: Supplier) =>
    run("all-stock", async () => {
      const n = await api.stock.checkSupplier(s.id);
      refreshSoon(RUN_REFRESHES);
      setDone(`Checking stock for ${n} ${n === 1 ? "link" : "links"} for ${s.name}, one page at a time. Answers will appear as they finish.`);
    });
  const checkAll = (s: Supplier) =>
    run("all-links", async () => {
      const n = await api.mappings.checkSupplierLinks(s.id);
      refreshSoon(RUN_REFRESHES);
      setDone(`Checking ${n} ${n === 1 ? "link" : "links"} for ${s.name}, one page at a time. Statuses will update as they finish.`);
    });
  const toggleHistory = (m: Mapping) =>
    run(`history:${m.id}`, async () => {
      if (history?.mapping.id === m.id) return setHistory(null);
      setHistory({ mapping: m, items: await api.stock.observations(m.id) });
    });
  const remove = async (m: Mapping) => {
    await api.mappings.remove(m.id);
    setDone(`Deleted the link for ${m.productTitle} (${m.variantTitle}).`);
    load();
  };

  const confirmedEmpty = data !== null && data.total === 0 && !filtered;
  // A page past the end, for example after deleting its last row, is read again from the last page, so show it as loading.
  const rows = data === null || (data.items.length === 0 && data.total > 0) ? null : data.items;
  const stockRegion = (m: Mapping) => m.region ?? suppliers.find((x) => x.id === m.supplierId)?.defaultRegion;

  const columns: Column<Mapping>[] = [
    {
      header: "Product",
      cell: (m) => (
        <>
          <span className="font-semibold">{m.productTitle}</span>
          <div className="text-muted-foreground">{m.sku ? `${m.variantTitle} · ${m.sku}` : m.variantTitle}</div>
          {m.variantRemoved && <div className="text-muted-foreground">Variant removed in Shopify</div>}
        </>
      ),
    },
    { header: "Supplier", cell: (m) => m.supplierName },
    { header: "Page", cell: (m) => <span className="break-all">{where(m.url)}</span> },
    {
      header: "Status",
      cell: (m) => {
        const s = linkStatusOf(m);
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={badgeVariant(s.tone)}>{s.words}</Badge>
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
            <Badge variant={badgeVariant(ANSWER_TONE[m.latestStock.answer])}>{stockSentence(m.latestStock, stockRegion(m))}</Badge>
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
        ) : (
          <span className="text-muted-foreground">No stock check yet</span>
        ),
    },
    {
      header: "Last checked",
      cell: (m) => (
        <div className="flex flex-col items-start gap-1">
          {m.lastLinkCheckAt ? formatWhen(m.lastLinkCheckAt) : <span className="text-muted-foreground">Never</span>}
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
              <DropdownMenuItem className="text-danger" onSelect={() => setConfirming(m)}>
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
      <div aria-live="polite" className={done ? "mb-4" : undefined}>
        {done && (
          <Notice kind="success" role="status">
            {done}
          </Notice>
        )}
      </div>
      {loading && data === null && !loadError && (
        <p role="status" className="sr-only">
          Loading links…
        </p>
      )}

      <Card className="overflow-hidden">
        {!confirmedEmpty && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <Input type="search" aria-label="Search links" placeholder="Search by product, variant or SKU" autoComplete="off" className="min-w-48 flex-1" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select aria-label="Supplier" value={supplierId} onChange={(e) => set({ supplier: e.target.value || undefined })}>
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Link status" value={status} onChange={(e) => set({ status: e.target.value || undefined })}>
              <option value="">Any status</option>
              {LINK_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.words}
                </option>
              ))}
            </Select>
            {supplier && (
              <>
                <Button variant="outline" disabled={busy} loading={busyKey === "all-links"} onClick={() => void checkAll(supplier)}>
                  Check all links for {supplier.name}
                </Button>
                <Button variant="outline" disabled={busy} loading={busyKey === "all-stock"} onClick={() => void checkAllStock(supplier)}>
                  Check all stock for {supplier.name}
                </Button>
              </>
            )}
          </div>
        )}
        <DataTable
          label="Links"
          columns={columns}
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
                  <Button variant="outline" onClick={() => set({ search: undefined, supplier: undefined, status: undefined })}>
                    Clear filters
                  </Button>
                }
              />
            )
          }
        />
        {data !== null && data.total > 0 && <Pager page={page} pageSize={pageSize} total={data.total} onPage={(n) => set({ page: n })} onPageSize={(n) => set({ pageSize: n })} />}
      </Card>

      {history && (
        <Card className="mt-6 p-4">
          <h3 className="mb-2 text-base font-semibold">Stock history for {label(history.mapping)}</h3>
          {history.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock checks yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm" aria-label={`Stock history for ${label(history.mapping)}`}>
              {history.items.map((o) => (
                <li key={o.id} className="border-b border-border pb-2 last:border-b-0">
                  <strong>{stockSentence(o, history.mapping.region)}</strong> · {formatWhen(o.observedAt)}
                  {o.recipeVersion !== null ? ` · rules version ${o.recipeVersion}` : ""}
                  {reasonWords(o.reason) && o.reason !== "not_listed" ? ` · ${reasonWords(o.reason)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {unmapped && (
        <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="unmapped-heading">
          <h2 id="unmapped-heading" className="mb-2 text-base font-semibold">
            Variants with no link
          </h2>
          {unmapped.unmapped === 0 && !vq ? (
            <p className="text-sm text-muted-foreground">Every variant has a link.</p>
          ) : (
            <>
              <p className="mb-3 text-sm">
                {unmapped.unmapped} of {unmapped.total} variants are not mapped
              </p>
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

      {confirming && (
        <ConfirmDialog
          open
          title={`Delete the link for ${label(confirming)}?`}
          description="The product stays in Shopify. Only the link to the supplier page is removed."
          confirmLabel="Delete link"
          onConfirm={() => remove(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}
