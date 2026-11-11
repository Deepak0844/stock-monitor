import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Select } from "@/components/ui/input.js";
import type { RecipeVersion } from "../api.js";
import { formatWhen } from "../format.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { diffRules, ruleLines } from "./ruleWords.js";

type Props = {
  versions: RecipeVersion[];
  busy: boolean;
  /** Why Turn on is off, or null. */
  turnOnBlock: string | null;
  onTurnOn: (v: RecipeVersion) => void;
  onEdit: (v: RecipeVersion) => void;
  onDelete: (v: RecipeVersion) => Promise<void>;
};

/** Each version opens to show what is in it, and how it differs from another, so the owner knows what turning it on changes. */
export function VersionList({ versions, busy, turnOnBlock, onTurnOn, onEdit, onDelete }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(versions[0] ? [versions[0].id] : []));
  const [against, setAgainst] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<RecipeVersion | null>(null);
  const turnedOn = versions.find((v) => v.active);

  const baseFor = (v: RecipeVersion): RecipeVersion | undefined => {
    const chosen = versions.find((x) => x.id === against[v.id] && x.id !== v.id);
    return (
      chosen ?? (turnedOn && turnedOn.id !== v.id ? turnedOn : versions.find((x) => x.id !== v.id))
    );
  };

  return (
    <>
      <ul aria-label="Versions" className="flex flex-col divide-y divide-border">
        {versions.map((v) => {
          const base = baseFor(v);
          const diff = base ? diffRules(v.rules, base.rules) : null;
          const lines = ruleLines(v.rules);
          const isOpen = open.has(v.id);
          return (
            <li key={v.id}>
              <details
                open={isOpen}
                onToggle={(e) => {
                  const now = (e.currentTarget as HTMLDetailsElement).open;
                  setOpen((o) => {
                    const next = new Set(o);
                    if (now) next.add(v.id);
                    else next.delete(v.id);
                    return next;
                  });
                }}
                className="group"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    className="size-4 transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  />
                  <span className="font-semibold">Version {v.version}</span>
                  <span className="text-sm text-muted-foreground">
                    saved {formatWhen(v.createdAt)}
                  </span>
                  <span className="flex-1" />
                  {v.active && <Badge variant="success">Turned on</Badge>}
                </summary>
                {isOpen && (
                  <div className="flex flex-col gap-4 px-4 pb-4 pl-11 max-sm:pl-4">
                    <div className="grid gap-3 text-sm">
                      {Object.entries(lines).map(([group, items]) => (
                        <div key={group}>
                          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group}
                          </h4>
                          <ul className="flex flex-col gap-1">
                            {items.map((line) => (
                              <li key={line} className="rounded-lg bg-muted px-2.5 py-1.5">
                                {line}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    {base && diff && (
                      <div className="flex flex-col gap-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor={`compare-${v.id}`}>Compare with</label>
                          <Select
                            id={`compare-${v.id}`}
                            className="h-9"
                            value={base.id}
                            onChange={(e) => setAgainst((a) => ({ ...a, [v.id]: e.target.value }))}
                          >
                            {versions
                              .filter((x) => x.id !== v.id)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  Version {x.version}
                                  {x.active ? " (turned on)" : ""}
                                </option>
                              ))}
                          </Select>
                        </div>
                        <div
                          aria-label={`Differences from version ${base.version}`}
                          className="rounded-lg border border-dashed border-border p-3"
                        >
                          {diff.added.length === 0 && diff.removed.length === 0 ? (
                            <span className="text-muted-foreground">Same rules.</span>
                          ) : (
                            <>
                              {diff.added.map((l) => (
                                <div key={`a${l}`} className="text-success">
                                  + {l}
                                </div>
                              ))}
                              {diff.removed.map((l) => (
                                <div key={`r${l}`} className="text-danger">
                                  − {l}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {!v.active && (
                        <Button
                          size="sm"
                          disabled={busy || turnOnBlock !== null}
                          aria-label={`Turn on version ${v.version}`}
                          onClick={() => onTurnOn(v)}
                        >
                          Turn on
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => onEdit(v)}>
                        Edit as new version
                      </Button>
                      {v.active ? (
                        <span className="text-sm text-muted-foreground">
                          This version is on, so it cannot be deleted. Turn another on first.
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-label={`Delete version ${v.version}`}
                          onClick={() => setDeleting(v)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ul>
      {deleting && (
        <ConfirmDialog
          open
          title={`Delete version ${deleting.version}?`}
          description="The rules in this version are removed. Past stock answers keep their “rules version” label. You cannot undo this."
          confirmLabel="Delete version"
          onConfirm={() => onDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
