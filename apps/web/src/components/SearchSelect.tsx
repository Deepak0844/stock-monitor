import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/utils.js";

export type SearchOption = { id: string; label: string; detail?: string; count?: number; disabled?: boolean; note?: string };

type Props = {
  /** What is being chosen, shown before the value: "Supplier: All suppliers". */
  label: string;
  value: string | null;
  /** The chosen option's name, when the options are searched on the server and may not be loaded. */
  valueLabel?: string;
  /** Short lists are filtered here, in the browser. */
  options?: SearchOption[];
  /** Long lists (variants) are searched on the server, a moment after typing stops. */
  search?(q: string): Promise<SearchOption[]>;
  /** An option that clears the choice, always first: "All suppliers". */
  allOption?: SearchOption;
  /** Names the search box, and shows inside it. */
  placeholder: string;
  noMatch(q: string): string;
  onChange(id: string | null): void;
  className?: string;
  /** For a form: the field's id, so its <label for> names the dropdown and the form can focus it on an error. */
  id?: string;
  /** For a form, where the label sits above: show only the value inside the field. */
  hideLabel?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

const SEARCH_DELAY_MS = 300;

const matches = (o: SearchOption, q: string) => {
  const needle = q.trim().toLowerCase();
  return needle === "" || o.label.toLowerCase().includes(needle) || (o.detail ?? "").toLowerCase().includes(needle);
};

/** Wraps every case-insensitive match of `q` in <mark>. */
function marked(text: string, q: string): ReactNode {
  const needle = q.trim();
  if (!needle) return text;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"));
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-[1px] bg-bad/20 text-inherit">{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}

/** A dropdown with a search box, for lists that can be long: suppliers and variants. Arrow keys move, Enter picks, Esc closes. */
export function SearchSelect({ label, value, valueLabel, options, search, allOption, placeholder, noMatch, onChange, className, id: fieldId, hideLabel, invalid, describedBy }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const [found, setFound] = useState<SearchOption[] | null>(null);
  const asked = useRef(0);

  // Server search: ask a moment after typing stops, and keep only the answer to the latest question.
  useEffect(() => {
    if (!open || !search) return;
    const n = ++asked.current;
    const timer = setTimeout(
      () =>
        void search(q.trim())
          .then((rows) => n === asked.current && setFound(rows))
          .catch(() => n === asked.current && setFound([])),
      q === "" ? 0 : SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [open, q, search]);

  const items = useMemo(() => {
    const list = search ? (found ?? []) : (options ?? []).filter((o) => matches(o, q));
    return allOption ? [allOption, ...list] : list;
  }, [search, found, options, q, allOption]);

  const shown = value === null ? (allOption?.label ?? "Choose") : (valueLabel ?? [...(options ?? []), ...(found ?? [])].find((o) => o.id === value)?.label ?? "Choose");
  const optionId = (o: SearchOption) => `${id}-opt-${o.id || "all"}`;

  const close = () => {
    setOpen(false);
    setQ("");
    setActive(-1);
  };
  const pick = (o: SearchOption | undefined) => {
    if (!o || o.disabled) return;
    onChange(allOption && o.id === allOption.id ? null : o.id);
    close();
  };
  const step = (dir: 1 | -1) => {
    for (let i = active + dir, n = 0; n < items.length; i += dir, n++) {
      const at = (i + items.length) % items.length;
      if (!items[at]!.disabled) return setActive(at);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    e.preventDefault();
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else pick(active >= 0 ? items[active] : items.find((o) => !o.disabled && o !== allOption));
  };

  return (
    <P.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <P.Trigger asChild>
        <button
          type="button"
          id={fieldId}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            "inline-flex h-11 min-w-56 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-expanded:border-foreground lg:h-8 lg:text-sm",
            className,
          )}
        >
          <span className="min-w-0 truncate">
            {!hideLabel && <span className="text-muted-foreground">{label}: </span>}
            {shown}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-[max(var(--radix-popover-trigger-width),20rem)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-foreground bg-popover text-popover-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)]"
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              role="combobox"
              aria-label={placeholder}
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 && items[active] ? optionId(items[active]) : undefined}
              placeholder={placeholder}
              autoComplete="off"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(-1);
              }}
              onKeyDown={onKey}
              className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground lg:h-9 lg:text-sm"
            />
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {items.map((o, i) => (
              <li
                key={o.id || "all"}
                id={optionId(o)}
                role="option"
                aria-selected={o.id === (value ?? "") || (value === null && o === allOption)}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm lg:min-h-8",
                  i === active && "bg-hover shadow-[inset_2px_0_0_var(--foreground)]",
                  o.disabled && "cursor-not-allowed text-muted-foreground",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{marked(o.label, q)}</span>
                  {o.detail && <span className="block truncate text-xs text-muted-foreground">{marked(o.detail, q)}</span>}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{o.note ?? o.count?.toLocaleString("en-GB")}</span>
              </li>
            ))}
          </ul>
          {items.filter((o) => o !== allOption).length === 0 && (
            <p className="px-3 pb-3 text-sm text-muted-foreground">{search && found === null ? "Searching…" : noMatch(q.trim())}</p>
          )}
          <p className="hidden gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground lg:flex">
            <span>↑ ↓ move</span>
            <span>Enter pick</span>
            <span>Esc close</span>
          </p>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
