import { useCallback } from "react";
import type { AppNotification } from "../api.js";
import {
  useGetNotificationListQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from "../store/api/notifications/notificationApi.js";

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

const COULD_NOT_LOAD = "Could not load notifications.";
const NONE: AppNotification[] = [];

/** The owner's notifications. Read again every 30 seconds while the tab is visible, and when it becomes visible. */
export function useNotifications(enabled: boolean): NotificationsState {
  const list = useGetNotificationListQuery({ enabled, poll: true });
  const markOne = useMarkNotificationReadMutation();
  const markAll = useMarkAllNotificationsReadMutation();
  const items = list.data ?? NONE;
  // The same functions on every render: App reads the list again on each page change through `reload`.
  const { refetch } = list;
  const { mutateAsync: markOneAsync } = markOne;
  const { mutateAsync: markAllAsync } = markAll;
  const reload = useCallback(() => void refetch(), [refetch]);
  const markRead = useCallback((id: string) => markOneAsync(id).catch(() => {}), [markOneAsync]);
  const markAllRead = useCallback(() => markAllAsync().catch(() => {}), [markAllAsync]);
  return {
    items,
    unread: items.filter((n) => n.readAt === null).length,
    loading: enabled && list.isPending,
    error: list.isError ? COULD_NOT_LOAD : null,
    // The count changes at once. If saving fails, the list is read again; the bell never shows the failure itself.
    markRead,
    markAllRead,
    reload,
  };
}
