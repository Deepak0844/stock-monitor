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
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  error: "border-danger/30 bg-danger-soft text-danger",
  info: "border-border bg-muted text-foreground",
};

/** A message with an icon and words, so meaning never depends on colour alone. */
export function Notice({ kind, children, role }: Props) {
  const Icon = ICONS[kind];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:shrink-0", TONES[kind])} role={role}>
      <Icon />
      <div className="min-w-0 font-medium">{children}</div>
    </div>
  );
}
