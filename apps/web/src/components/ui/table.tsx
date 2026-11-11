import * as React from "react";
import { cn } from "@/lib/utils.js";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      {/* Explicit roles keep this a table for screen readers when a phone restyles it as cards (see `table.stack` in theme.css). */}
      <table role="table" className={cn("stack w-full border-collapse text-sm md:min-w-[40rem]", className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: React.ComponentProps<"thead">) => <thead role="rowgroup" {...p} />;
export const TableBody = (p: React.ComponentProps<"tbody">) => <tbody role="rowgroup" {...p} />;
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr role="row" className={cn("border-t border-border hover:bg-muted/60", className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th role="columnheader" className={cn("bg-muted/60 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)} {...props} />;
}
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td role="cell" className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
