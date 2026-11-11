import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, AppNotification } from "../api.js";

export type NotificationsState = {
  /** Everything open, newest first, read or not. */
  items: AppNotification[];
  unread: number;
  loading: boolean;
  error: string | null;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  reload(): void;
};

const POLL_MS = 30_000;
const COULD_NOT_LOAD = "Could not load notifications.";

/** The owner's notifications. Read again every 30 seconds while the tab is visible, and when it becomes visible. */
export function useNotifications(api: Api, enabled: boolean): NotificationsState {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  /** Goes up whenever something is marked read, so an answer to an older request can be told apart. */
  const changes = useRef(0);

  const reload = useCallback(() => {
    const asked = changes.current;
    api.notifications
      .list()
      .then((rows) => {
        // Asked for before something was marked read: it may still show that as unread. The next read is right.
        if (!alive.current || asked !== changes.current) return;
        setItems(rows);
        setError(null);
      })
      .catch(() => alive.current && setError(COULD_NOT_LOAD))
      .finally(() => alive.current && setLoading(false));
  }, [api]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => void (alive.current = false);
    reload();
    const timer = window.setInterval(() => !document.hidden && reload(), POLL_MS);
    const onVisible = () => !document.hidden && reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, reload]);

  // The count changes at once. If saving fails, the list is read again so it shows what is true.
  const markRead = useCallback(
    async (id: string) => {
      changes.current++;
      const now = new Date().toISOString();
      setItems((rows) => rows.map((n) => (n.id === id && n.readAt === null ? { ...n, readAt: now } : n)));
      try {
        await api.notifications.markRead(id);
      } catch {
        reload();
      }
    },
    [api, reload],
  );

  const markAllRead = useCallback(async () => {
    changes.current++;
    const now = new Date().toISOString();
    setItems((rows) => rows.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)));
    try {
      await api.notifications.markAllRead();
    } catch {
      reload();
    }
  }, [api, reload]);

  return { items, unread: items.filter((n) => n.readAt === null).length, loading, error, markRead, markAllRead, reload };
}
