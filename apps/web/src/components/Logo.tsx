import { cn } from "@/lib/utils.js";

// A simple mark in ink: three steps, like stock levels.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-bold tracking-tight", className)}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className="fill-current">
        <path d="M0 16V6.4h5.3V0h5.4v9.6H16V16z" />
      </svg>
      <span>Stock Monitor</span>
    </span>
  );
}
