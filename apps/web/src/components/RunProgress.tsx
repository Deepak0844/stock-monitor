import type { CheckRun } from "../api.js";

/** A check that is running now: how far it has got, in words, with a thin progress line. Updates as the page reads the run again. */
export function RunProgress({ run, name }: { run: CheckRun; name: string }) {
  const share = run.linksTotal > 0 ? run.linksDone / run.linksTotal : 0;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2 font-medium">
        <span aria-hidden="true" className="size-[7px] rounded-full bg-good motion-safe:animate-pulse" />
        Checking now
      </span>
      <span className="font-mono text-xs text-ink-soft">
        {run.linksDone} of {run.linksTotal} links · {run.outOfStock} out so far
      </span>
      <svg
        role="progressbar"
        aria-label={`Check of ${name}`}
        aria-valuemin={0}
        aria-valuemax={run.linksTotal}
        aria-valuenow={run.linksDone}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="block h-0.5 w-full max-w-56"
      >
        <rect width={1} height={1} className="fill-border" />
        <rect width={share} height={1} className="fill-good" />
      </svg>
    </div>
  );
}
