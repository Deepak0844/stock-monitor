import * as React from "react";
import { DropdownMenu as M } from "radix-ui";
import { cn } from "@/lib/utils.js";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;

export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align="end"
        sideOffset={6}
        className={cn("z-50 min-w-44 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg", className)}
        {...props}
      />
    </M.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn("flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4", className)}
      {...props}
    />
  );
}
