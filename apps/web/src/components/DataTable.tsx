import type { ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.js";

export type Column<T> = { header: string; cell(row: T): ReactNode; className?: string; hideHeader?: boolean };

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
};

/** A list: skeleton rows while it loads, a retryable error if it fails, the empty message when there is nothing. */
export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, empty, pageSize, label }: Props<T>) {
  const showRows = !error && rows !== null && rows.length > 0;
  return (
    <div role="region" aria-label={label} aria-busy={loading} className="min-w-0">
      {error ? (
        <div className="flex flex-col items-start gap-3 p-4">
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {(loading && rows === null) || showRows ? (
            <Table>
              <TableHeader>
                <tr>
                  {columns.map((c) => (
                    <TableHead key={c.header} className={c.className}>
                      {c.hideHeader ? <span className="sr-only">{c.header}</span> : c.header}
                    </TableHead>
                  ))}
                </tr>
              </TableHeader>
              <TableBody>
                {rows === null
                  ? Array.from({ length: pageSize }, (_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        {columns.map((c) => (
                          <TableCell key={c.header} className={c.className}>
                            <Skeleton className={i % 2 ? "w-2/3" : "w-4/5"} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : rows.map((row) => (
                      <TableRow key={rowKey(row)} className={loading ? "opacity-60" : undefined}>
                        {columns.map((c) => (
                          <TableCell key={c.header} className={c.className}>
                            {c.cell(row)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          ) : (
            rows !== null && empty
          )}
        </>
      )}
    </div>
  );
}
