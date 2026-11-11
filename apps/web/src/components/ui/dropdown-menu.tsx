import * as React from "react";
import { DropdownMenu as M } from "radix-ui";
import { cn } from "@/lib/utils.js";

// Radix opens its menu when the pointer goes down. On a touch screen the menu then appears under the finger, and letting go
// chooses whatever item is there. Here the menu opens on the click instead, after the finger is up.
const Toggle = React.createContext<() => void>(() => {});

export function DropdownMenu(props: React.ComponentProps<typeof M.Root>) {
  const [open, setOpen] = React.useState(false);
  const toggle = React.useCallback(() => setOpen((o) => !o), []);
  return (
    <Toggle.Provider value={toggle}>
      <M.Root {...props} open={open} onOpenChange={setOpen} />
    </Toggle.Provider>
  );
}

export function DropdownMenuTrigger({ onPointerDown, onClick, ...props }: React.ComponentProps<typeof M.Trigger>) {
  const toggle = React.useContext(Toggle);
  return (
    <M.Trigger
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        event.preventDefault(); // stops Radix opening on press
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggle();
      }}
    />
  );
}

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
      className={cn("flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4", className)}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-3 py-2 text-xs text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}
