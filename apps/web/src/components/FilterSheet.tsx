import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";

/** On a phone: one "Filters · N" button that opens the filters on a full screen. They apply as they change. */
export function FilterSheet({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden="true" />
        {count > 0 ? `Filters · ${count}` : "Filters"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          hideClose
          className="inset-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 p-0 data-[state=open]:zoom-in-100"
        >
          <div className="flex h-14 items-center justify-between border-b border-border pl-4 pr-2">
            <DialogTitle className="text-base font-semibold">Filters</DialogTitle>
            <Button variant="ghost" onClick={onClear}>
              Clear all
            </Button>
          </div>
          <DialogDescription className="sr-only">The list changes as you choose.</DialogDescription>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 [&_button]:w-full [&_select]:w-full">
            {children}
          </div>
          <div className="border-t border-foreground p-4">
            <Button className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
