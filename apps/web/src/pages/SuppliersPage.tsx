import { useEffect, useState } from "react";
import {
  Link as ListChecks,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Input, Select } from "@/components/ui/input.js";
import type { Api, ScheduleRow, Supplier, SupplierStatusFilter } from "../api.js";
import {
  useCheckSupplierSessionMutation,
  useGetSupplierListQuery,
  useGetSupplierPageQuery,
  useRemoveSupplierMutation,
  useSetSupplierEnabledMutation,
  useSupplierChanged,
} from "../store/api/suppliers/supplierApi.js";
import { useGetScheduleOverviewQuery } from "../store/api/schedule/scheduleApi.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DataTable, type Column } from "../components/DataTable.js";
import { EmptyState } from "../components/EmptyState.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { FilterChips } from "../components/FilterChips.js";
import { recentChecksSentence } from "../components/recentChecks.js";
import { RowsSwitch } from "../components/RowsSwitch.js";
import { RunProgress } from "../components/RunProgress.js";
import { When } from "../components/When.js";
import { Pager } from "../components/Pager.js";
import { StatRow, StatTile } from "../components/StatTile.js";
import { useListParams } from "../lib/useListParams.js";
import { useWatch } from "../lib/useWatch.js";
import { intervalWords, runSummary, whenWords } from "../components/scheduleWords.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";
import { toast } from "../lib/toast.js";

// A connection check can include an automatic login and an emailed code, so the supplier is read again for up to 3 minutes.
const CHECK_READS = 60;
const SEARCH_PAUSE_MS = 300;
const STATUSES: { value: SupplierStatusFilter; label: string }[] = [
  { value: "connected", label: "Connected" },
  { value: "needs_reconnect", label: "Needs reconnecting" },
  { value: "blocked", label: "Blocked" },
  { value: "paused", label: "Paused" },
  { value: "not_connected", label: "Not connected" },
  { value: "no_login", label: "No login needed" },
];
// While a run is going, its progress is read again this often.
const PROGRESS_REFRESH_MS = 5000;
const NO_ROWS: ScheduleRow[] = [];

const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

/**
 * The one word shown for a supplier. Paused wins when the owner paused it. When the app paused it because its login
 * needs attention, the reason is what the owner has to act on, so that is shown instead.
 */
export function statusOf(s: Supplier): { words: string; tone: "success" | "warning" | "neutral" } {
  if (!s.enabled && s.pausedReason !== "session") return { words: "Paused", tone: "neutral" };
  if (!s.needsLogin && !refusedNoLogin(s)) return { words: "No login needed", tone: "success" };
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

/** A supplier that needs no login, paused by the app because its website refused a check. Shown and filed as Blocked. */
const refusedNoLogin = (s: Supplier) => !s.needsLogin && s.pausedReason === "session" && s.sessionStatus === "blocked";

/** The one status key the filter and the tiles use: paused wins, as `statusOf` does. */
const keyOf = (s: Supplier): SupplierStatusFilter =>
  !s.enabled && s.pausedReason !== "session"
    ? "paused"
    : !s.needsLogin && !refusedNoLogin(s)
      ? "no_login"
      : s.sessionStatus;

/** What the schedule is doing for one supplier, in a few plain lines. */
function ScheduleCell({ row }: { row: ScheduleRow | undefined }) {
  if (!row || row.status.state === "off")
    return <span className="text-muted-foreground">Automatic checks off</span>;
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
      {status.state !== "running" && row.lastRun && (
        <div className="text-muted-foreground">{runSummary(row.lastRun)}</div>
      )}
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
  const status = STATUSES.some((o) => o.value === params.filters.status)
    ? (params.filters.status as SupplierStatusFilter)
    : undefined;
  const filtering = search !== "" || status !== undefined;

  const supplierPage = useGetSupplierPageQuery({ page, pageSize, search: search || undefined, status });
  const data = supplierPage.data ? { items: supplierPage.data.items, total: supplierPage.data.total } : null;
  // Loading while the first read or a new page is on its way; the rows shown stay until the next ones arrive.
  const loading = supplierPage.isPlaceholderData || (supplierPage.isFetching && !supplierPage.data);
  const loadError = supplierPage.isError && !supplierPage.isFetching && !supplierPage.data ? message(supplierPage.error) : null;
  const load = () => void supplierPage.refetch();
  // Every supplier, for the summary tiles. If it cannot be read the tiles are left out.
  const all = useGetSupplierListQuery().data ?? null;
  const setEnabled = useSetSupplierEnabledMutation();
  const checkSession = useCheckSupplierSessionMutation();
  const removeSupplier = useRemoveSupplierMutation();
  const replace = useSupplierChanged();
  // The schedule and any run's progress, read again every few seconds for as long as a run is going. A failure only leaves the
  // column as it was: the suppliers themselves still show.
  const schedule =
    useGetScheduleOverviewQuery({
      refetchEvery: (rows) => (rows?.some((r) => r.status.state === "running") ? PROGRESS_REFRESH_MS : false),
    }).data ?? NO_ROWS;
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Supplier | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  // Suppliers whose check was asked for and whose new status has not shown yet.
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  const stopWaiting = (id: string) =>
    setWaiting((w) => (w.has(id) ? new Set([...w].filter((x) => x !== id)) : w));
  const [q, setQ] = useState(search);
  const watch = useWatch();

  // The search box waits for a pause in typing, then goes to the address. A change made elsewhere, such as clearing, comes back in.
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => set({ search: q }), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [q, search, set]);
  useEffect(() => setQ(search), [search]);


  async function act(work: () => Promise<void>) {
    setActionError(null);
    try {
      await work();
    } catch (e) {
      setActionError(message(e));
    }
  }
  const toggle = (s: Supplier) =>
    act(async () =>
      void (await setEnabled.mutateAsync({ supplier: s, enabled: !s.enabled })),
    );
  // Setting "no login needed" again lifts the app's pause and clears its notice, so the next scheduled check runs.
  const tryAgain = (s: Supplier) =>
    act(async () => {
      replace(await api.suppliers.setNeedsLogin(s.id, false));
      toast(`${s.name} will be checked again.`);
    });
  const check = (s: Supplier) =>
    act(async () => {
      setCheckingId(s.id);
      setWaiting((w) => new Set(w).add(s.id));
      try {
        await checkSession.mutateAsync({ id: s.id });
      } catch (e) {
        stopWaiting(s.id);
        throw e;
      } finally {
        setCheckingId(null);
      }
      toast(`A check of ${s.name} has started. Its status will update in a moment.`);
      // The supplier's small status is asked until the check has finished, then the supplier is read once; only its row changes.
      void watch(
        `session:${s.id}`,
        CHECK_READS,
        () => api.suppliers.status(s.id),
        (st) => st.checkedAt !== s.lastSessionCheckAt,
      )
        .then(async (finished) => finished && replace(await api.suppliers.get(s.id)))
        .catch(() => {})
        .finally(() => stopWaiting(s.id));
    });
  const remove = async (s: Supplier) => {
    await removeSupplier.mutateAsync({ id: s.id });
    toast(`Deleted ${s.name}.`);
  };

  const confirmedEmpty = data !== null && data.total === 0 && !filtering;
  // A page past the end, for example after deleting its last row, is read again from the last page, so show it as loading.
  const rows = data === null || (data.items.length === 0 && data.total > 0) ? null : data.items;
  const count = (key?: SupplierStatusFilter) =>
    all === null ? null : key ? all.filter((s) => keyOf(s) === key).length : all.length;

  const columns: Column<Supplier>[] = [
    {
      header: "Supplier",
      cell: (s) => (
        <>
          <span className="font-semibold">{s.name}</span>
          <span className="cell-sub">{hostOf(s.websiteUrl)}</span>
        </>
      ),
    },
    {
      header: "Status",
      phone: "half",
      cell: (s) => {
        const st = statusOf(s);
        return (
          <>
            {waiting.has(s.id) ? (
              <Badge variant="warning" className="animate-pulse">
                Checking…
              </Badge>
            ) : (
              <Badge variant={st.tone}>{st.words}</Badge>
            )}
            <span className="cell-sub">
              {s.lastSessionCheckAt ? (
                <>
                  Checked <When at={s.lastSessionCheckAt} />
                </>
              ) : (
                "Never checked"
              )}
            </span>
          </>
        );
      },
    },
    {
      header: "Recent checks",
      phone: "inline-label",
      cell: (s) => {
        const row = schedule.find((r) => r.supplierId === s.id);
        if (!row) return <span className="text-muted-foreground">No checks yet</span>;
        if (row.status.state === "running" && row.run)
          return <RunProgress run={row.run} name={s.name} />;
        const said = recentChecksSentence(row, new Date());
        return (
          <span
            data-tone={said.tone}
            className={said.tone === "bad" ? "font-semibold text-bad" : "text-ink-soft"}
          >
            {said.text}
          </span>
        );
      },
    },
    {
      header: "Automatic checks",
      phone: "half",
      cell: (s) => <ScheduleCell row={schedule.find((r) => r.supplierId === s.id)} />,
    },
    {
      header: "Actions",
      hideHeader: true,
      className: "text-right",
      cell: (s) => (
        <div className="flex items-center justify-end gap-2">
          {!s.needsLogin ? (
            refusedNoLogin(s) && (
              <Button variant="outline" size="sm" aria-label={`Try again ${s.name}`} onClick={() => void tryAgain(s)}>
                Try again
              </Button>
            )
          ) : s.sessionStatus === "connected" ? (
            <Button
              variant="outline"
              size="sm"
              loading={checkingId === s.id}
              disabled={waiting.has(s.id)} // until the check's answer shows, so it is not asked for twice
              aria-label={`Check connection ${s.name}`}
              onClick={() => void check(s)}
            >
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
              <Button
                variant="outline"
                size="icon"
                className="size-9"
                aria-label={`More actions for ${s.name}`}
              >
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
        <StatRow>
          <StatTile
            label="All suppliers"
            value={count()}
            to="/suppliers"
            selected={status === undefined}
          />
          <StatTile
            label="Connected"
            value={count("connected")}
            to="/suppliers?status=connected"
            selected={status === "connected"}
          />
          <StatTile
            label="Needs reconnecting"
            value={count("needs_reconnect")}
            to="/suppliers?status=needs_reconnect"
            tone="warning"
            selected={status === "needs_reconnect"}
          />
          <StatTile
            label="Paused"
            value={count("paused")}
            to="/suppliers?status=paused"
            selected={status === "paused"}
          />
        </StatRow>
      )}

      {actionError && (
        <div className="mb-4">
          <Notice kind="error" role="alert">
            {actionError}
          </Notice>
        </div>
      )}

      {loading && data === null && !loadError && (
        <p role="status" className="sr-only">
          Loading suppliers…
        </p>
      )}

      <div className="min-w-0">
        {!confirmedEmpty && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
            <Input
              type="search"
              aria-label="Search suppliers"
              placeholder="Search by name or website"
              className="min-w-48 flex-1"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              aria-label="Filter by status"
              value={status ?? ""}
              onChange={(e) => set({ status: e.target.value || undefined })}
            >
              <option value="">All statuses</option>
              {STATUSES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <span className="ml-auto">
              <RowsSwitch />
            </span>
          </div>
        )}
        <FilterChips
          chips={[
            ...(search
              ? [
                  {
                    key: "search",
                    label: "Search",
                    value: `"${search}"`,
                    onRemove: () => set({ search: undefined }),
                  },
                ]
              : []),
            ...(status
              ? [
                  {
                    key: "status",
                    label: "Status",
                    value: STATUSES.find((o) => o.value === status)!.label,
                    onRemove: () => set({ status: undefined }),
                  },
                ]
              : []),
          ]}
          onClearAll={() => set({ search: undefined, status: undefined })}
        />
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
                  <Button
                    variant="outline"
                    onClick={() => set({ search: undefined, status: undefined })}
                  >
                    Clear search and filters
                  </Button>
                }
              />
            )
          }
        />
        {data !== null && data.total > 0 && (
          <Pager
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPage={(n) => set({ page: n })}
            onPageSize={(n) => set({ pageSize: n })}
          />
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          open
          title={`Delete ${confirming.name}?`}
          description="This removes the supplier, its links and its saved login. Stock already in Shopify is not changed. You cannot undo this."
          confirmLabel="Delete supplier"
          onConfirm={() => remove(confirming)}
          onClose={() => setConfirming(null)}
          returnFocusTo={() =>
            document.querySelector<HTMLElement>(
              `[aria-label="More actions for ${confirming.name}"]`,
            )
          }
        />
      )}
    </>
  );
}
