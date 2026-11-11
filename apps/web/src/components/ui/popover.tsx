import * as React from "react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/utils.js";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;

export function PopoverContent({ className, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align="end"
        sideOffset={8}
        className={cn("z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover text-popover-foreground shadow-lg", className)}
        {...props}
      />
    </P.Portal>
  );
}
