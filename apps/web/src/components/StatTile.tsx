import { cn } from "@/lib/utils.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Link } from "../router.js";

type Props = { label: string; value: number | null; to?: string; tone?: "default" | "warning" };

/** One number and what it counts. A link when it has somewhere to go. A shimmer while the number loads. */
export function StatTile({ label, value, to, tone = "default" }: Props) {
  const body = (
    <>
      <span className="block text-sm text-muted-foreground">{label}</span>
      {value === null ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <span className={cn("block text-3xl font-bold tabular-nums leading-tight", tone === "warning" && value > 0 && "text-warning")}>{value}</span>
      )}
    </>
  );
  const box = "block rounded-xl border border-border bg-card p-4 shadow-sm";
  return to && value !== null ? (
    <Link to={to} className={cn(box, "transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-ring")}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}
