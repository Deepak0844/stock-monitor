import { cn } from "@/lib/utils.js";

// A simple mark: three stock bars in a rounded square.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-bold", className)}>
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="8" className="fill-accent" />
        <rect x="7" y="17" width="4.5" height="8" rx="1.25" fill="#2a1608" />
        <rect x="13.75" y="12" width="4.5" height="13" rx="1.25" fill="#2a1608" />
        <rect x="20.5" y="7" width="4.5" height="18" rx="1.25" fill="#2a1608" />
      </svg>
      <span>Stock Monitor</span>
    </span>
  );
}
