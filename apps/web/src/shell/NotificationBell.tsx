import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { formatAgo } from "../format.js";
import { Link } from "../router.js";
import type { AppNotification } from "../api.js";
import type { NotificationsState } from "./useNotifications.js";

/** Where each kind of notification is fixed. */
function fixFor(n: AppNotification): string {
  if (n.kind === "recipe_needs_review") return `/suppliers/${n.supplierId}/rules`;
  if (n.kind === "proposal_needs_attention") return "/proposals";
  return `/suppliers/${n.supplierId}/connect`;
}

export function NotificationBell({ state }: { state: NotificationsState }) {
  const [open, setOpen] = useState(false);
  const { items, unread, loading, error } = state;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative" aria-label={`Notifications, ${unread === 0 ? "none" : unread} unread`}>
          <Bell aria-hidden="true" />
          {unread > 0 && (
            <span aria-hidden="true" className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.7rem] font-bold leading-5 text-accent-foreground">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Notifications" role="dialog">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button variant="ghost" size="sm" disabled={unread === 0} onClick={() => void state.markAllRead()}>
            Mark all as read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
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
          ) : items.length === 0 && !error ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className="border-b border-border last:border-b-0">
                  <Link
                    to={fixFor(n)}
                    onClick={() => {
                      void state.markRead(n.id);
                      setOpen(false);
                    }}
                    className="flex gap-3 px-4 py-3 hover:bg-muted"
                  >
                    <span aria-hidden="true" className={n.readAt === null ? "mt-1.5 size-2 shrink-0 rounded-full bg-accent" : "mt-1.5 size-2 shrink-0"} />
                    <span className="min-w-0">
                      <span className={n.readAt === null ? "block text-sm font-semibold" : "block text-sm"}>{n.message}</span>
                      <span className="block text-xs text-muted-foreground">{formatAgo(n.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
