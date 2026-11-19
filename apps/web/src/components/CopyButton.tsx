import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { Tip } from "./ui/tooltip.js";

const SHOWN_MS = 2000;

/** A small icon that copies a SKU, a link or a name. For two seconds it turns into a tick (or a cross if the browser refuses);
 * the words are read to screen readers. Nothing appears beside it, so the row never changes size. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [said, setSaid] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [said]);

  const copy = () =>
    navigator.clipboard
      .writeText(value)
      .then(() => setSaid("copied"))
      .catch(() => setSaid("failed"));

  const Icon = said === "copied" ? Check : said === "failed" ? X : Copy;
  return (
    <span className="relative inline-flex align-middle">
      <Tip label={said === "copied" ? "Copied" : said === "failed" ? "Couldn't copy" : `Copy ${label}`}>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          data-state={said ?? undefined}
          onClick={() => void copy()}
          className={cn(
            "grid size-6 cursor-pointer place-items-center rounded-md border border-transparent text-muted-foreground hover:border-input hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-lg:size-9 [&_svg]:size-3.5",
            said === "copied" && "text-good hover:text-good",
            said === "failed" && "text-bad hover:text-bad",
          )}
        >
          <Icon aria-hidden="true" />
        </button>
      </Tip>
      <span aria-live="polite" className="sr-only">
        {said === "copied" ? "Copied" : said === "failed" ? "Couldn't copy" : ""}
      </span>
    </span>
  );
}
