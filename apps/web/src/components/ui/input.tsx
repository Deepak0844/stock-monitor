import * as React from "react";
import { cn } from "@/lib/utils.js";

const field =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-60";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(field, className)} {...props} />;
}

/** A native select in the same style. Native keeps keyboard and phone behaviour for free. */
export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(field, "w-auto pr-8", className)} {...props} />;
}
