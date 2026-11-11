import type { ReactNode } from "react";
import { cn } from "@/lib/utils.js";

type Props = { id: string; title: string; description?: ReactNode; children?: ReactNode; className?: string };

/** A titled card for a settings area or a form. The heading names the section for screen readers. */
export function Panel({ id, title, description, children, className }: Props) {
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm", className)}>
      <div>
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Labels and values, side by side where there is room. */
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-semibold text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A box inside a panel, for a form or a question that belongs to that panel. */
export function SubPanel({ children, ...rest }: React.ComponentProps<"div">) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4" {...rest}>
      {children}
    </div>
  );
}
