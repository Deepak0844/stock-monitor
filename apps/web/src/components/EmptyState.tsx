import type { ReactNode } from "react";
import { FileX, Link2, SearchX, TriangleAlert } from "lucide-react";

type Kind = "empty" | "no-match" | "error" | "not-found";
const ICON = {
  empty: Link2,
  "no-match": SearchX,
  error: TriangleAlert,
  "not-found": FileX,
} as const;

type Props = {
  /** Nothing yet, nothing matches the filters, it could not load, or the page is gone. */
  kind?: Kind;
  title: string;
  description?: string;
  /** A small technical line under the words, for example "timeout after 30 s · 09:14". */
  detail?: string;
  action?: ReactNode;
};

/** What to show instead of a list: says what happened in plain words and offers the next step. One thin icon, no drawings. */
export function EmptyState({ kind = "empty", title, description, detail, action }: Props) {
  const Icon = ICON[kind];
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-10 sm:px-6">
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-7 text-ink-soft" />
      <p
        className="text-base font-semibold"
        role={kind === "error" ? "alert" : undefined}
      >
        {title}
      </p>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground lg:text-[0.8125rem]">{description}</p>
      )}
      {detail && (
        <code className="rounded-sm bg-hover px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {detail}
        </code>
      )}
      {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
