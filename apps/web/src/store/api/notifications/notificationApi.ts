import { mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, AppNotification } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey, listKey } from "../apiUtils.js";

// The owner's notifications: the open list, and marking them read.

// Key type.
const NOTIFICATION = "Notification";

export const notificationKeys = {
  all: allKey(NOTIFICATION),
  list: () => listKey(NOTIFICATION),
};

/** While the tab is shown, the list is read again this often. */
export const NOTIFICATION_POLL_MS = 30_000;

/**
 * Marks some notifications read at once in the cache. A read already on its way is stopped first: its answer was asked for
 * before this change and could show them unread again.
 */
async function markInCache(client: QueryClient, isMarked: (n: AppNotification) => boolean) {
  await client.cancelQueries({ queryKey: notificationKeys.list() });
  const now = new Date().toISOString();
  client.setQueryData<AppNotification[]>(notificationKeys.list(), (rows) =>
    rows?.map((n) => (n.readAt === null && isMarked(n) ? { ...n, readAt: now } : n)),
  );
}

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getNotificationListQuery = (api: Api) =>
  queryOptions({
    queryKey: notificationKeys.list(),
    queryFn: () => api.notifications.list(),
    // New ones arrive from the server by themselves, so a page that opens reads them again; the cached copy shows meanwhile.
    staleTime: 0,
  });

const markNotificationReadMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onMutate: (id) => markInCache(client, (n) => n.id === id),
    // Saving failed: read the list again so it shows what is true.
    onError: () => client.invalidateQueries({ queryKey: notificationKeys.list() }),
  });

const markAllNotificationsReadMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: () => api.notifications.markAllRead(),
    onMutate: () => markInCache(client, () => true),
    onError: () => client.invalidateQueries({ queryKey: notificationKeys.list() }),
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

/** `poll` reads it again every 30 s while the tab is shown. */
export function useGetNotificationListQuery({ enabled = true, poll = false }: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({ ...getNotificationListQuery(useApi()), enabled, refetchInterval: poll ? NOTIFICATION_POLL_MS : false });
}

export function useMarkNotificationReadMutation() {
  return useMutation(markNotificationReadMutation(useApi(), useQueryClient()));
}

export function useMarkAllNotificationsReadMutation() {
  return useMutation(markAllNotificationsReadMutation(useApi(), useQueryClient()));
}
