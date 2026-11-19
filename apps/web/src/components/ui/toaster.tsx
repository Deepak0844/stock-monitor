import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { dismissToast, getToasts, runToastAction, subscribeToasts } from "@/lib/toast.js";

/** Where messages appear: bottom right on a wide screen, across the bottom above the tabs on a phone. Successes are read out
 * politely, errors as alerts. */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-20 z-[70] flex flex-col items-stretch gap-2 lg:inset-x-auto lg:right-4 lg:bottom-4 lg:w-[25rem]">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-center gap-3 rounded-md bg-foreground px-3 py-2.5 text-sm text-background shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)] animate-in fade-in-0 slide-in-from-bottom-2",
            t.kind === "error" && "shadow-[inset_3px_0_0_var(--bad),0_10px_30px_-10px_rgba(0,0,0,0.45)]",
          )}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => runToastAction(t.id)}
              className="h-10 shrink-0 cursor-pointer rounded-md border border-background/45 px-3 text-xs font-semibold hover:bg-background/10 focus-visible:outline-2 focus-visible:outline-ring lg:h-7"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-md opacity-75 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring lg:size-7"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
