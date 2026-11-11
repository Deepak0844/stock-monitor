import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm(): Promise<void>;
  onClose(): void;
  /** Where focus goes when the dialog closes. The menu item that opened it is gone by then. Falls back to the main area. */
  returnFocusTo?: () => HTMLElement | null;
};

/** Asks before something that cannot be undone. Stays open, with the reason, if the action fails. */
export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose, returnFocusTo }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        hideClose
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          (returnFocusTo?.() ?? document.getElementById("main"))?.focus();
        }}
        onEscapeKeyDown={(e) => busy && e.preventDefault()} onInteractOutside={(e) => busy && e.preventDefault()}>
        <div className="mb-3 grid size-10 place-items-center rounded-full bg-danger-soft text-danger">
          <TriangleAlert className="size-5" aria-hidden="true" />
        </div>
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">{description}</DialogDescription>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
