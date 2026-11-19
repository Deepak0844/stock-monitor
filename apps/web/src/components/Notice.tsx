import type { ReactNode } from "react";
import { cn } from "@/lib/utils.js";
import { IconAlert, IconCheck, IconInfo } from "./icons.js";

type Props = {
  kind: "success" | "warning" | "error" | "info";
  children: ReactNode;
  /** "alert" is announced at once, for problems. "status" is announced politely. */
  role?: "alert" | "status";
};

const ICONS = { success: IconCheck, warning: IconAlert, error: IconAlert, info: IconInfo };
const TONES = {
  success: "border-good [&_svg]:text-good",
  warning: "border-bad [&_svg]:text-bad",
  error: "border-bad [&_svg]:text-bad",
  info: "border-foreground [&_svg]:text-muted-foreground",
};

/** A message: a coloured edge, an icon and plain words, so meaning never depends on colour alone. */
export function Notice({ kind, children, role }: Props) {
  const Icon = ICONS[kind];
  return (
    <div className={cn("flex items-start gap-3 border-l-2 py-1.5 pr-2 pl-3 text-sm text-foreground [&_svg]:mt-0.5 [&_svg]:shrink-0", TONES[kind])} role={role}>
      <Icon />
      <div className="min-w-0 font-medium">{children}</div>
    </div>
  );
}
