import { cn } from "@/lib/utils.js";
import { usePreference } from "@/lib/preferences.js";

const CHOICES = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
] as const;

/** "Rows: Comfortable | Compact". The choice is saved on the device and applies to every table. Wide screens only. */
export function RowsSwitch() {
  const [rows, setRows] = usePreference("rows");
  return (
    <div role="group" aria-label="Rows" className="hidden items-center gap-2 text-[0.8125rem] text-muted-foreground lg:inline-flex">
      Rows
      <span className="inline-flex h-8 overflow-hidden rounded-md border border-input">
        {CHOICES.map((c, i) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={rows === c.value}
            onClick={() => setRows(c.value)}
            className={cn(
              "cursor-pointer px-2.5 text-xs font-medium text-ink-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              i > 0 && "border-l border-input",
              rows === c.value && "bg-foreground font-semibold text-background",
            )}
          >
            {c.label}
          </button>
        ))}
      </span>
    </div>
  );
}
