import { X } from "lucide-react";
import { Button } from "@/components/ui/button.js";

export type FilterChip = { key: string; label: string; value: string; onRemove(): void };

/** Every filter in use, as a small tag above a list: ✕ removes one, Clear all removes them all. Nothing shows when no filter is set. */
export function FilterChips({ chips, onClearAll }: { chips: FilterChip[]; onClearAll(): void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 sm:px-0">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input pr-1 pl-2.5 text-sm lg:h-7 lg:text-xs">
          {c.label}: <b className="font-semibold">{c.value}</b>
          <button
            type="button"
            aria-label={`Remove ${c.label} filter`}
            onClick={c.onRemove}
            className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:size-5"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}
      {chips.length >= 2 && (
        <Button variant="link" size="sm" onClick={onClearAll}>
          Clear all
        </Button>
      )}
    </div>
  );
}
