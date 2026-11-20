import * as React from "react";
import { cn } from "@/lib/utils.js";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto lg:overflow-visible">
      {/* Explicit roles keep this a table for screen readers when a phone restyles it as stacked rows (see `table.stack` in theme.css). */}
      <table role="table" className={cn("stack w-full border-collapse text-sm lg:text-[0.8125rem]", className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: React.ComponentProps<"thead">) => <thead role="rowgroup" {...p} />;
export const TableBody = (p: React.ComponentProps<"tbody">) => <tbody role="rowgroup" {...p} />;
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr role="row" className={cn("border-t border-rule-soft first:border-t-0 hover:bg-hover", className)} {...props} />;
}
/** Headings stay on screen while a long list scrolls on a wide screen, just under the top bar. */
export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      role="columnheader"
      className={cn("border-b border-foreground bg-background px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground lg:sticky lg:top-[3.0625rem] lg:z-10", className)}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td role="cell" className={cn("px-3 py-[11px] align-top", className)} {...props} />;
}
