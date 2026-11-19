import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { Tip } from "./ui/tooltip.js";

const SHOWN_MS = 2000;

/** A small icon that copies a SKU, a link or a name. It says "Copied" for two seconds, or "Couldn't copy" if the browser refuses. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [said, setSaid] = useState<"Copied" | "Couldn't copy" | null>(null);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [said]);

  const copy = () =>
    navigator.clipboard
      .writeText(value)
      .then(() => setSaid("Copied"))
      .catch(() => setSaid("Couldn't copy"));

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <Tip label={`Copy ${label}`}>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => void copy()}
          className="grid size-6 cursor-pointer place-items-center rounded-md border border-transparent text-muted-foreground hover:border-input hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-lg:size-9 [&_svg]:size-3.5"
        >
          <Copy aria-hidden="true" />
        </button>
      </Tip>
      <span aria-live="polite" className={said === "Copied" ? "text-xs font-semibold text-good" : "text-xs font-semibold text-bad"}>
        {said}
      </span>
    </span>
  );
}
