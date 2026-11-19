import type { ReactNode } from "react";
import { cn } from "@/lib/utils.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Link } from "../router.js";

/** A row of number tiles with a thin rule between each. Two across on a phone, as many as given on a wide screen. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-6 grid grid-cols-2 gap-px border-y border-border bg-border lg:auto-cols-fr lg:grid-flow-col", className)}>{children}</div>;
}

type Props = { label: string; value: number | null; to?: string; tone?: "default" | "warning"; selected?: boolean };

/** One number and what it counts. A link when it has somewhere to go, marked when it is the filter in use. A shimmer while it loads. */
export function StatTile({ label, value, to, tone = "default", selected = false }: Props) {
  const body = (
    <>
      <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {value === null ? (
        <Skeleton className="mt-2 h-6 w-14" />
      ) : (
        <span className={cn("mt-1 block font-mono text-2xl leading-tight font-medium tracking-tight", tone === "warning" && value > 0 && "text-bad")}>{value}</span>
      )}
    </>
  );
  const box = cn("block bg-background px-4 py-3 lg:px-5", selected && "shadow-[inset_0_-2px_0_var(--foreground)]");
  return to && value !== null ? (
    <Link to={to} aria-current={selected ? "true" : undefined} className={cn(box, "transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring")}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}
