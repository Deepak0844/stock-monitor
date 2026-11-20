import { formatWhen } from "../format.js";
import { Tip } from "./ui/tooltip.js";

const full = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "medium" });

/** A time in lined-up figures. Hovering or focusing it shows the full date and time. */
export function When({ at }: { at: string }) {
  return (
    <Tip label={full(at)}>
      <time dateTime={at} tabIndex={0} className="font-mono underline decoration-border decoration-dotted underline-offset-3 focus-visible:outline-2 focus-visible:outline-ring">
        {formatWhen(at)}
      </time>
    </Tip>
  );
}
