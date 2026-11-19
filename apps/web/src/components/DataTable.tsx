import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.js";
import { Tip } from "@/components/ui/tooltip.js";
import { usePreference } from "@/lib/preferences.js";
import { useWide } from "@/lib/useWide.js";
import { cn } from "@/lib/utils.js";
import { EmptyState } from "./EmptyState.js";

export type Column<T> = {
  header: string;
  cell(row: T): ReactNode;
  className?: string;
  hideHeader?: boolean;
  /** The server's name for this column, when the list can be sorted by it. */
  sortKey?: string;
  /** Cut a long value off with "…" and put the whole of it in a tooltip (`title`). */
  truncate?: boolean;
  title?(row: T): string;
};

export type TableSort = { key: string; dir: "asc" | "desc" };
export type TableSelection<T> = { selected: ReadonlySet<string>; onChange(next: Set<string>): void; rowLabel(row: T): string };

type Props<T> = {
  columns: Column<T>[];
  /** null until the first load finishes. */
  rows: T[] | null;
  rowKey(row: T): string;
  loading: boolean;
  error: string | null;
  onRetry(): void;
  empty: ReactNode;
  /** How many skeleton rows to show while loading. */
  pageSize: number;
  /** Names the table for screen readers. */
  label: string;
  sort?: TableSort | null;
  onSort?(key: string): void;
  /** Tick boxes for choosing rows, with one in the heading for the whole page. */
  selection?: TableSelection<T>;
};

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

/** The heading box: ticked when every row on the page is, "mixed" when only some are. */
function PageBox({ ids, selection }: { ids: string[]; selection: TableSelection<unknown> }) {
  const ref = useRef<HTMLInputElement>(null);
  const ticked = ids.filter((id) => selection.selected.has(id)).length;
  const all = ids.length > 0 && ticked === ids.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = ticked > 0 && !all;
  }, [ticked, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all on this page"
      checked={all}
      onChange={() => {
        const next = new Set(selection.selected);
        ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
        selection.onChange(next);
      }}
      className="size-4 cursor-pointer accent-foreground"
    />
  );
}

/** A list: skeleton rows while it loads, a retryable error if it fails, the empty message when there is nothing. Headings can
 * sort, rows can be ticked, and the owner's row height applies on a wide screen. On a phone each row stacks into a block. */
export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, empty, pageSize, label, sort, onSort, selection }: Props<T>) {
  const [chosen] = usePreference("rows");
  // Rows are always comfortable on a phone, so they stay easy to tap.
  const density = useWide() ? chosen : "comfortable";
  const showRows = !error && rows !== null && rows.length > 0;
  const ids = rows?.map(rowKey) ?? [];

  if (error) {
    return (
      <EmptyState
        kind="error"
        title={error}
        action={
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }
  if (!((loading && rows === null) || showRows)) return <div className="min-w-0">{rows !== null && empty}</div>;

  const heading = (c: Column<T>) => {
    if (c.hideHeader) return <span className="sr-only">{c.header}</span>;
    if (!c.sortKey || !onSort) return c.header;
    const on = sort?.key === c.sortKey ? sort.dir : null;
    const Icon = on === "asc" ? ArrowUp : on === "desc" ? ArrowDown : ArrowUpDown;
    return (
      <button
        type="button"
        onClick={() => onSort(c.sortKey!)}
        className={cn("inline-flex cursor-pointer items-center gap-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", on && "font-semibold text-foreground")}
      >
        {c.header}
        <Icon aria-hidden="true" className={cn("size-3", !on && "opacity-50")} />
      </button>
    );
  };

  return (
    <div className="min-w-0">
      <Table aria-label={label} aria-busy={loading} data-density={density}>
        <TableHeader>
          <tr role="row">
            {selection && (
              <TableHead className="w-8">
                <PageBox ids={ids} selection={selection as TableSelection<unknown>} />
              </TableHead>
            )}
            {columns.map((c) => (
              <TableHead key={c.header} className={c.className} aria-sort={c.sortKey && onSort ? (sort?.key === c.sortKey ? ARIA_SORT[sort.dir] : "none") : undefined}>
                {heading(c)}
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {rows === null
            ? Array.from({ length: pageSize }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {selection && <TableCell />}
                  {columns.map((c) => (
                    <TableCell key={c.header} className={c.className} data-label={c.hideHeader ? undefined : c.header}>
                      <Skeleton className={i % 2 ? "w-2/3" : "w-4/5"} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row) => {
                const id = rowKey(row);
                const ticked = selection?.selected.has(id) ?? false;
                return (
                  <TableRow key={id} data-selected={ticked || undefined} className={cn(loading && "opacity-60", ticked && "bg-selected hover:bg-selected")}>
                    {selection && (
                      <TableCell className="w-8">
                        <input
                          type="checkbox"
                          aria-label={`Select ${selection.rowLabel(row)}`}
                          checked={ticked}
                          onChange={() => {
                            const next = new Set(selection.selected);
                            if (ticked) next.delete(id);
                            else next.add(id);
                            selection.onChange(next);
                          }}
                          className="size-5 cursor-pointer accent-foreground lg:size-4"
                        />
                      </TableCell>
                    )}
                    {columns.map((c) => (
                      <TableCell key={c.header} className={c.className} data-label={c.hideHeader ? undefined : c.header}>
                        {c.truncate ? (
                          <Tip label={c.title?.(row) ?? ""}>
                            <span tabIndex={0} className="block max-w-[16rem] truncate focus-visible:outline-2 focus-visible:outline-ring">
                              {c.cell(row)}
                            </span>
                          </Tip>
                        ) : (
                          c.cell(row)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
        </TableBody>
      </Table>
    </div>
  );
}
