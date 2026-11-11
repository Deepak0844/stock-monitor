import { useCallback, useEffect, useRef, useState } from "react";
import { Link as ListChecks, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.js";
import { Input, Select } from "@/components/ui/input.js";
import type { Api, ScheduleRow, Supplier, SupplierStatusFilter } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DataTable, type Column } from "../components/DataTable.js";
import { EmptyState } from "../components/EmptyState.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { Pager } from "../components/Pager.js";
import { StatTile } from "../components/StatTile.js";
import { useListParams } from "../lib/useListParams.js";
import { intervalWords, runSummary, whenWords } from "../components/scheduleWords.js";
import { formatWhen } from "../format.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const CHECK_REFRESH_MS = 4000;
const CHECK_REFRESHES = 12;
const SEARCH_PAUSE_MS = 300;
const STATUSES: { value: SupplierStatusFilter; label: string }[] = [
  { value: "connected", label: "Connected" },
  { value: "needs_reconnect", label: "Needs reconnecting" },
  { value: "blocked", label: "Blocked" },
  { value: "paused", label: "Paused" },
  { value: "not_connected", label: "Not connected" },
];
// While a run is going, its progress is read again this often.
const PROGRESS_REFRESH_MS = 5000;

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/**
 * The one word shown for a supplier. Paused wins when the owner paused it. When the app paused it because its login
 * needs attention, the reason is what the owner has to act on, so that is shown instead.
 */
function statusOf(s: Supplier): { words: string; tone: "success" | "warning" | "neutral" } {
  if (!s.enabled && s.pausedReason !== "session") return { words: "Paused", tone: "neutral" };
  switch (s.sessionStatus) {
    case "connected":
      return { words: "Connected", tone: "success" };
    case "needs_reconnect":
      return { words: "Needs reconnecting", tone: "warning" };
    case "blocked":
      return { words: "Blocked", tone: "warning" };
    default:
      return { words: "Not connected", tone: "neutral" };
  }
}

/** The one status key the filter and the tiles use: paused wins, as `statusOf` does. */
const keyOf = (s: Supplier): SupplierStatusFilter => (!s.enabled && s.pausedReason !== "session" ? "paused" : s.sessionStatus);

/** What the schedule is doing for one supplier, in a few plain lines. */
function ScheduleCell({ row }: { row: ScheduleRow | undefined }) {
  if (!row || row.status.state === "off") return <span className="text-muted-foreground">Automatic checks off</span>;
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
      {status.state !== "running" && row.lastRun && <div className="text-muted-foreground">{runSummary(row.lastRun)}</div>}
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
  const params = useListParams({ pageSize: 10 });
  const { page, pageSize, search, set } = params;
  const status = STATUSES.some((o) => o.value === params.filters.status) ? (params.filters.status as SupplierStatusFilter) : undefined;
  const filtering = search !== "" || status !== undefined;

  const [data, setData] = useState<{ items: Supplier[]; total: number } | null>(null);
  const [all, setAll] = useState<Supplier[] | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Supplier | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [q, setQ] = useState(search);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const query = { page, pageSize, search: search || undefined, status };
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = useCallback(() => {
    const mine = ++latest.current;
    setLoading(true);
    setLoadError(null);
    api.suppliers
      .page({ page, pageSize, search: search || undefined, status })
      .then((result) => {
        if (mine !== latest.current) return;
        setData({ items: result.items, total: result.total });
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (mine !== latest.current) return;
        setLoadError(message(e));
        setLoading(false);
      });
  }, [api, page, pageSize, search, status]);
  useEffect(load, [load]);

  // Every supplier, once, for the summary tiles. If it cannot be read the tiles are left out.
  useEffect(() => {
    api.suppliers.list().then(setAll).catch(() => {});
  }, [api]);

  // The search box waits for a pause in typing, then goes to the address. A change made elsewhere, such as clearing, comes back in.
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => set({ search: q }), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [q, search, set]);
  useEffect(() => setQ(search), [search]);

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
  // A check takes a moment. The page is read again shortly after one is asked for, and never after the page is left.
  useEffect(() => () => void (refreshTimer.current && clearTimeout(refreshTimer.current)), []);

  const replace = (updated: Supplier) => {
    setData((d) => d && { ...d, items: d.items.map((s) => (s.id === updated.id ? updated : s)) });
    setAll((list) => list?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
  };
  async function act(work: () => Promise<void>) {
    setActionError(null);
    setDone(null);
    try {
      await work();
    } catch (e) {
      setActionError(message(e));
    }
  }
  const toggle = (s: Supplier) => act(async () => replace(await (s.enabled ? api.suppliers.pause(s.id) : api.suppliers.resume(s.id))));
  /** Reads the page again, a few times a few seconds apart, because a check finishes some moments after it is asked for. */
  const refreshSoon = (times: number, finished: (list: Supplier[]) => boolean) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      api.suppliers
        .page(queryRef.current)
        .then((result) => {
          setData({ items: result.items, total: result.total });
          if (!finished(result.items) && times > 1) refreshSoon(times - 1, finished);
        })
        .catch(() => {});
    }, CHECK_REFRESH_MS);
  };
  const check = (s: Supplier) =>
    act(async () => {
      setCheckingId(s.id);
      try {
        await api.suppliers.checkSession(s.id);
      } finally {
        setCheckingId(null);
      }
      setDone(`A check of ${s.name} has started. Its status will update in a moment.`);
      refreshSoon(CHECK_REFRESHES, (list) => list.find((x) => x.id === s.id)?.lastSessionCheckAt !== s.lastSessionCheckAt);
    });
  const remove = async (s: Supplier) => {
    await api.suppliers.remove(s.id);
    setAll((list) => list?.filter((x) => x.id !== s.id) ?? null);
    setDone(`Deleted ${s.name}.`);
    load();
  };

  const confirmedEmpty = data !== null && data.total === 0 && !filtering;
  // A page past the end, for example after deleting its last row, is read again from the last page, so show it as loading.
  const rows = data === null || (data.items.length === 0 && data.total > 0) ? null : data.items;
  const count = (key?: SupplierStatusFilter) => (all === null ? null : key ? all.filter((s) => keyOf(s) === key).length : all.length);

  const columns: Column<Supplier>[] = [
    { header: "Name", cell: (s) => <span className="font-semibold">{s.name}</span> },
    { header: "Website", cell: (s) => hostOf(s.websiteUrl) },
    {
      header: "Status",
      cell: (s) => {
        const st = statusOf(s);
        return <Badge variant={st.tone}>{st.words}</Badge>;
      },
    },
    { header: "Last checked", cell: (s) => (s.lastSessionCheckAt ? formatWhen(s.lastSessionCheckAt) : <span className="text-muted-foreground">Never</span>) },
    { header: "Automatic checks", cell: (s) => <ScheduleCell row={schedule.find((r) => r.supplierId === s.id)} /> },
    {
      header: "Actions",
      hideHeader: true,
      className: "text-right",
      cell: (s) => (
        <div className="flex items-center justify-end gap-2">
          {s.sessionStatus === "connected" ? (
            <Button variant="outline" size="sm" loading={checkingId === s.id} aria-label={`Check connection ${s.name}`} onClick={() => void check(s)}>
              Check connection
            </Button>
          ) : s.sessionStatus === "not_connected" ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/suppliers/${s.id}/connect`} aria-label={`Connect ${s.name}`}>
                Connect
              </Link>
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link to={`/suppliers/${s.id}/connect`} aria-label={`Reconnect supplier ${s.name}`}>
                Reconnect supplier
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-9" aria-label={`More actions for ${s.name}`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem asChild>
                <Link to={`/suppliers/${s.id}/rules`}>
                  <ListChecks aria-hidden="true" />
                  Stock rules
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/suppliers/${s.id}/edit`}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void toggle(s)}>
                {s.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {s.enabled ? "Pause" : "Resume"}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-danger" onSelect={() => setConfirming(s)}>
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
        title="Suppliers"
        description="The supplier websites this app checks for stock."
        actions={
          !confirmedEmpty && (
            <Button asChild>
              <Link to="/suppliers/new">
                <Plus aria-hidden="true" />
                Add supplier
              </Link>
            </Button>
          )
        }
      />

      {all !== null && !confirmedEmpty && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="All suppliers" value={count()} to="/suppliers" />
          <StatTile label="Connected" value={count("connected")} to="/suppliers?status=connected" />
          <StatTile label="Needs reconnecting" value={count("needs_reconnect")} to="/suppliers?status=needs_reconnect" tone="warning" />
          <StatTile label="Paused" value={count("paused")} to="/suppliers?status=paused" />
        </div>
      )}

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
          Loading suppliers…
        </p>
      )}

      <Card className="overflow-hidden">
        {!confirmedEmpty && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <Input type="search" aria-label="Search suppliers" placeholder="Search by name or website" className="min-w-48 flex-1" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select aria-label="Filter by status" value={status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
              <option value="">All statuses</option>
              {STATUSES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <DataTable
          label="Suppliers"
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          loading={loading}
          error={loadError}
          onRetry={load}
          pageSize={pageSize}
          empty={
            confirmedEmpty ? (
              <EmptyState
                title="No suppliers yet. Add your first supplier."
                description="A supplier is a website you check for stock. You connect it once, then choose how often it is checked."
                action={
                  <Button asChild>
                    <Link to="/suppliers/new">
                      <Plus aria-hidden="true" />
                      Add supplier
                    </Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No suppliers match your search or filter."
                action={
                  <Button variant="outline" onClick={() => set({ search: undefined, status: undefined })}>
                    Clear search and filters
                  </Button>
                }
              />
            )
          }
        />
        {data !== null && data.total > 0 && <Pager page={page} pageSize={pageSize} total={data.total} onPage={(n) => set({ page: n })} onPageSize={(n) => set({ pageSize: n })} />}
      </Card>

      {confirming && (
        <ConfirmDialog
          open
          title={`Delete ${confirming.name}?`}
          description="This removes the supplier, its links and its saved login. Stock already in Shopify is not changed. You cannot undo this."
          confirmLabel="Delete supplier"
          onConfirm={() => remove(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}
