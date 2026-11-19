import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input, Select } from "@/components/ui/input.js";
import { useWide } from "@/lib/useWide.js";
import { PAGE_SIZES } from "../lib/useListParams.js";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPage(n: number): void;
  onPageSize(n: number): void;
};

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

/** Where you are in a long list, the page numbers, Previous and Next, rows per page, and a box to jump straight to a page.
 * On a phone it shrinks to "‹ Page 2 of 87 ›" with big buttons. */
export function Pager({ page, pageSize, total, onPage, onPageSize }: Props) {
  const wide = useWide();
  const last = Math.max(1, Math.ceil(total / pageSize));
  const [goTo, setGoTo] = useState("");
  useEffect(() => {
    // A bookmarked page that no longer exists, for example after deleting rows, shows the last page instead.
    if (total > 0 && page > last) onPage(last);
  }, [page, last, total, onPage]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const jump = () => {
    const n = Number(goTo.trim());
    if (!Number.isInteger(n) || n < 1) return;
    onPage(Math.min(n, last));
    setGoTo("");
  };

  const prev = (
    <Button
      variant="outline"
      size={wide ? "icon" : "default"}
      aria-label="Previous page"
      disabled={page <= 1}
      onClick={() => onPage(page - 1)}
    >
      <ChevronLeft aria-hidden="true" />
    </Button>
  );
  const next = (
    <Button
      variant="outline"
      size={wide ? "icon" : "default"}
      aria-label="Next page"
      disabled={page >= last}
      onClick={() => onPage(page + 1)}
    >
      <ChevronRight aria-hidden="true" />
    </Button>
  );

  if (!wide) {
    return (
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <span className="font-mono">{total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}</span>
        {total > 0 && (
          <div className="flex items-center justify-between gap-3">
            {prev}
            <span className="font-mono text-foreground">
              Page {page} of {last}
            </span>
            {next}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground px-4 py-2.5 text-[0.8125rem] text-muted-foreground">
      <span className="font-mono">
        {total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          Rows per page
          <Select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="font-mono"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <nav aria-label="Pagination" className="flex items-center gap-0.5">
          {prev}
          {pageNumbers(page, last).map((n, i) =>
            n === "gap" ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 font-mono">
                …
              </span>
            ) : (
              <Button
                key={n}
                variant={n === page ? "outline" : "ghost"}
                size="icon"
                className={n === page ? "border-foreground font-mono" : "font-mono font-medium"}
                aria-label={`Page ${n}`}
                aria-current={n === page ? "page" : undefined}
                onClick={() => onPage(n)}
              >
                {n}
              </Button>
            ),
          )}
          {next}
        </nav>
        {last > 7 && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              jump();
            }}
          >
            <label htmlFor="go-to-page">Go to page</label>
            <Input
              id="go-to-page"
              inputMode="numeric"
              className="w-16 font-mono"
              value={goTo}
              onChange={(e) => setGoTo(e.target.value)}
            />
            <Button type="submit" variant="outline" size="sm">
              Go
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
