import type { InspectControl, LoginInspection, LoginSelectors } from "../api.js";

export type Role = "open" | "account" | "username" | "password" | "submit";
/** "auto" and "none" store nothing. "saved:<selector>" is a selector saved earlier. Anything else is a selector. */
export type Pick = string;

export const ROLES: { role: Role; label: string }[] = [
  { role: "open", label: "Button that opens the login" },
  { role: "account", label: "Account box" },
  { role: "username", label: "Username box" },
  { role: "password", label: "Password box" },
  { role: "submit", label: "Button that logs in" },
];

const IS_BOX: Record<Role, boolean> = { open: false, account: true, username: true, password: true, submit: false };
export const SAVED = "saved:";

/** What the owner can pick for a role: what a login would use first, then every visible control of the right kind, each once. */
export function candidatesFor(inspection: LoginInspection, role: Role): InspectControl[] {
  const found = inspection.found[role];
  const list = [...(found ? [found] : []), ...(IS_BOX[role] ? inspection.fields : inspection.buttons)];
  return list.filter((c, i) => list.findIndex((x) => x.selector === c.selector) === i);
}

/** Where each row starts: on a saved selector (kept even when the page no longer has it), else on automatic. */
export function startingPicks(saved: LoginSelectors | null | undefined, inspection: LoginInspection): Record<Role, Pick> {
  const picks = {} as Record<Role, Pick>;
  for (const { role } of ROLES) {
    const selector = saved?.[role];
    picks[role] = !selector ? "auto" : candidatesFor(inspection, role).some((c) => c.selector === selector) ? selector : `${SAVED}${selector}`;
  }
  return picks;
}

/** The picks that carry a selector, as the supplier's saved login fields, or null when there are none. */
export function selectorsFromPicks(picks: Record<Role, Pick>): LoginSelectors | null {
  const out: LoginSelectors = {};
  for (const { role } of ROLES) {
    const pick = picks[role];
    if (pick === "auto" || pick === "none") continue;
    out[role] = pick.startsWith(SAVED) ? pick.slice(SAVED.length) : pick;
  }
  return Object.keys(out).length > 0 ? out : null;
}
