import { cn } from "@/lib/utils.js";

// The brand mark: a "b" holding a moving cart. The "b" turns light in dark mode so it stays visible.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-bold tracking-tight", className)}>
      <svg viewBox="104 111 840 840" width="28" height="28" aria-hidden="true" focusable="false">
        <path
          className="fill-brand-ink"
          d="M293 117h114a38 38 0 0 1 38 38v155a330 330 0 1 1-202 380h117v-153H255V155a38 38 0 0 1 38-38z"
        />
        <circle cx="570" cy="615" r="235" fill="#fff" stroke="#f2400a" strokeWidth="40" />
        <path
          fill="none"
          stroke="#e63c10"
          strokeWidth="42"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M415 513h50l40 172h165l48-130H475M492 625h196"
        />
        <g fill="#e63c10">
          <circle cx="510" cy="752" r="37" />
          <circle cx="645" cy="752" r="37" />
          <rect x="192" y="563" width="218" height="39" rx="19.5" />
          <rect x="148" y="626" width="262" height="39" rx="19.5" />
        </g>
      </svg>
      <span>Stock Monitor</span>
    </span>
  );
}
