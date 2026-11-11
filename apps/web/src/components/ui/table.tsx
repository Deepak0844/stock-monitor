import * as React from "react";
import { cn } from "@/lib/utils.js";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full min-w-[40rem] border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: React.ComponentProps<"thead">) => <thead {...p} />;
export const TableBody = (p: React.ComponentProps<"tbody">) => <tbody {...p} />;
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-t border-border hover:bg-muted/60", className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("bg-muted/60 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)} {...props} />;
}
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
