import type { ReactNode } from "react";
import { Link } from "../router.js";

type Props = { title: string; description?: string; actions?: ReactNode; back?: { to: string; label: string } };

/** The top of a page: an optional way back, its one h1, a line saying what it is for, and the page's main actions. */
export function PageHeader({ title, description, actions, back }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-1 inline-block text-sm text-muted-foreground hover:text-foreground lg:text-[0.8125rem]">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight lg:text-[1.0625rem]">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground lg:text-[0.8125rem]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
