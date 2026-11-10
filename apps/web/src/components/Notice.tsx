import type { ReactNode } from "react";
import { IconAlert, IconCheck, IconInfo } from "./icons.js";

type Props = {
  kind: "success" | "warning" | "error" | "info";
  children: ReactNode;
  /** "alert" is announced at once, for problems. "status" is announced politely. */
  role?: "alert" | "status";
};

const ICONS = { success: IconCheck, warning: IconAlert, error: IconAlert, info: IconInfo };

/** A message with an icon and words, so meaning never depends on colour alone. */
export function Notice({ kind, children, role }: Props) {
  const Icon = ICONS[kind];
  return (
    <div className={`notice ${kind}`} role={role}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}
