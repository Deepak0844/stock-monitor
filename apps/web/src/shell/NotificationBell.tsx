import { useState } from "react";
import { Bell, CircleAlert, ClipboardList, KeyRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { formatAgo } from "../format.js";
import { cn } from "@/lib/utils.js";
import { Link } from "../router.js";
import type { AppNotification } from "../api.js";
import type { NotificationsState } from "./useNotifications.js";

/** Where each kind of notification is fixed. */
function fixFor(n: AppNotification): string {
  if (n.kind === "recipe_needs_review") return `/suppliers/${n.supplierId}/rules`;
  if (n.kind === "proposal_needs_attention") return "/proposals";
  return `/suppliers/${n.supplierId}/connect`;
}

/** The icon, the words on its button, and one line on what is going on, for each kind. */
const KINDS: Record<AppNotification["kind"], { Icon: LucideIcon; action: string }> = {
  supplier_needs_reconnect: { Icon: KeyRound, action: "Log in again" },
  recipe_needs_review: { Icon: ClipboardList, action: "Review stock rules" },
  proposal_needs_attention: { Icon: CircleAlert, action: "See suggestions" },
};
const DETAIL: Partial<Record<AppNotification["reason"], string>> = {
  login_required: "Checks wait until you log in.",
  captcha: "It showed a puzzle. Checks wait until you solve it.",
  blocked: "It refused the check. Checks wait for you.",
  page_changed: "Its pages changed, so answers say Cannot tell.",
};
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export function NotificationBell({ state }: { state: NotificationsState }) {
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const { items, unread, loading, error } = state;
  const shown = onlyUnread ? items.filter((n) => n.readAt === null) : items;
  const groups = [
    { label: "Today", list: shown.filter((n) => isToday(n.createdAt)) },
    { label: "Earlier", list: shown.filter((n) => !isToday(n.createdAt)) },
  ].filter((g) => g.list.length > 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground"
          aria-label={`Notifications, ${unread === 0 ? "none" : unread} unread`}
        >
          <Bell aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full border-[1.5px] border-background bg-accent px-0.5 font-mono text-[0.625rem] font-semibold leading-none text-accent-foreground lg:-right-0.5 lg:-top-0.5"
            >
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Notifications"
        role="dialog"
        className="w-[min(26rem,calc(100vw-1rem))]"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            onClick={() => void state.markAllRead()}
          >
            Mark all as read
          </Button>
        </div>
        <div className="flex gap-4 border-b border-border px-4 text-[0.8125rem]">
          {[
            { label: "All", on: !onlyUnread, value: false },
            { label: `Unread · ${unread}`, on: onlyUnread, value: true },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              aria-pressed={t.on}
              onClick={() => setOnlyUnread(t.value)}
              className={cn(
                "min-h-11 cursor-pointer lg:min-h-9",
                t.on
                  ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--foreground)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="max-h-[min(32rem,calc(100dvh-9rem))] overflow-y-auto">
          {error && (
            <p role="alert" className="px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          {loading && items.length === 0 && !error ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ) : shown.length === 0 && !error ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {onlyUnread ? "Nothing unread." : "You're all caught up."}
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.label}>
                <h3 className="px-4 pb-1 pt-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.label}
                </h3>
                <ul aria-label={g.label}>
                  {g.list.map((n) => {
                    const { Icon, action } = KINDS[n.kind];
                    const fresh = n.readAt === null;
                    return (
                      <li key={n.id} className="border-b border-rule-soft last:border-b-0">
                        <Link
                          to={fixFor(n)}
                          onClick={() => {
                            void state.markRead(n.id);
                            setOpen(false);
                          }}
                          className={cn(
                            "grid grid-cols-[1.75rem_1fr_auto] gap-3 px-4 py-3 hover:bg-hover",
                            fresh && "bg-hover/60",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "grid size-7 place-items-center rounded-full",
                              fresh
                                ? "bg-danger-soft text-danger"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            <Icon className="size-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className={cn("block text-sm", fresh && "font-semibold")}>
                              {n.message}
                            </span>
                            {DETAIL[n.reason] && (
                              <span className="block text-xs text-muted-foreground">
                                {DETAIL[n.reason]}
                              </span>
                            )}
                            <span className="mt-2 inline-flex h-10 items-center rounded-md border border-input px-3 text-[0.8125rem] font-semibold lg:h-7 lg:px-2.5">
                              {action}
                            </span>
                          </span>
                          <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                            {formatAgo(n.createdAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
