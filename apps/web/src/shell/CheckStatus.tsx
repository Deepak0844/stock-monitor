import type { ScheduleRow } from "../api.js";
import { usePreference } from "../lib/preferences.js";
import { Link } from "../router.js";
import { checkStatusOf } from "./checkSummary.js";

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** A small box at the foot of the sidebar: are checks running, when is the next one, and is any supplier stopped. */
export function CheckStatus({ rows }: { rows: ScheduleRow[] | null }) {
  const [show] = usePreference("checkStatus");
  if (!show || rows === null) return null;
  const { on, nextAt, stopped } = checkStatusOf(rows);
  return (
    <section
      aria-label="Checks"
      className="flex flex-col gap-1 border-t border-border px-4 py-3 text-[0.8125rem]"
    >
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Checks
      </h2>
      <p className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={on ? "size-[7px] rounded-full bg-good" : "size-[7px] rounded-full bg-neutral"}
        />
        {on ? (
          <span>
            On
            {nextAt && (
              <>
                {" "}
                · next at <span className="font-mono">{clock(nextAt)}</span>
              </>
            )}
          </span>
        ) : (
          <span>Off</span>
        )}
      </p>
      {stopped > 0 && (
        <p className="flex items-center gap-2 font-semibold text-bad">
          <span aria-hidden="true" className="size-[7px] rounded-full bg-bad" />
          {stopped} {stopped === 1 ? "supplier" : "suppliers"} stopped
        </p>
      )}
      <Link to="/suppliers" className="w-fit underline underline-offset-3 hover:text-ink-soft">
        See suppliers
      </Link>
    </section>
  );
}
