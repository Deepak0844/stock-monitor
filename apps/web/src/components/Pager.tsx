import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Select } from "@/components/ui/input.js";
import { PAGE_SIZES } from "../lib/useListParams.js";

type Props = { page: number; pageSize: number; total: number; onPage(n: number): void; onPageSize(n: number): void };

/** Page numbers to show: all of them when few, else the first, the last and the ones near the current page. */
function pageNumbers(page: number, last: number): (number | "gap")[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const wanted = new Set([1, last, page - 1, page, page + 1].filter((n) => n >= 1 && n <= last));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - (sorted[i - 1] as number) > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export function Pager({ page, pageSize, total, onPage, onPageSize }: Props) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    // A bookmarked page that no longer exists, for example after deleting rows, shows the last page instead.
    if (total > 0 && page > last) onPage(last);
  }, [page, last, total, onPage]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
      <span>{total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}</span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Rows per page
          <Select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-9">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-9" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          {pageNumbers(page, last).map((n, i) =>
            n === "gap" ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1">
                …
              </span>
            ) : (
              <Button
                key={n}
                variant={n === page ? "default" : "outline"}
                size="icon"
                className="size-9"
                aria-label={`Page ${n}`}
                aria-current={n === page ? "page" : undefined}
                onClick={() => onPage(n)}
              >
                {n}
              </Button>
            ),
          )}
          <Button variant="outline" size="icon" className="size-9" aria-label="Next page" disabled={page >= last} onClick={() => onPage(page + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      </div>
    </div>
  );
}
