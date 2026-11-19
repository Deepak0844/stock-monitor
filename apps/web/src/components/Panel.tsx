import type { ReactNode } from "react";
import { cn } from "@/lib/utils.js";

type Props = { id: string; title: string; description?: ReactNode; children?: ReactNode; className?: string };

/** A ruled section of a settings page or a form: its title and what it is for on the left, its content on the right on a wide
 * screen, one above the other on a phone. The heading names the section for screen readers. */
export function Panel({ id, title, description, children, className }: Props) {
  return (
    <section aria-labelledby={id} className={cn("grid gap-4 border-t border-border py-6 first:border-t-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8", className)}>
      <div>
        <h2 id={id} className="text-base font-semibold lg:text-[0.9375rem]">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground lg:text-[0.8125rem]">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
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
    <div className="flex flex-col gap-3 rounded-md border border-border p-4" {...rest}>
      {children}
    </div>
  );
}
