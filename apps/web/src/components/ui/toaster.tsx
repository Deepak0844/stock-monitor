import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { dismissToast, getToasts, subscribeToasts } from "@/lib/toast.js";

/** Where toasts appear: the bottom right, announced politely to screen readers. */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-lg animate-in fade-in-0 slide-in-from-bottom-2">
          <span className="min-w-0 flex-1">{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="grid size-6 shrink-0 place-items-center rounded-md opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
