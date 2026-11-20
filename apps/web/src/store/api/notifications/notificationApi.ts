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
 * Marks some notifications read at once in the cache, and says whether there was a list to mark. A read already on its way is
 * stopped first: its answer was asked for before this change and could show them unread again. While the first list is still
 * on its way there is nothing to mark, so that read is left to finish and the list is read again once the mark is saved.
 */
async function markInCache(client: QueryClient, isMarked: (n: AppNotification) => boolean): Promise<{ marked: boolean }> {
  if (client.getQueryData(notificationKeys.list()) === undefined) return { marked: false };
  await client.cancelQueries({ queryKey: notificationKeys.list() });
  const now = new Date().toISOString();
  client.setQueryData<AppNotification[]>(notificationKeys.list(), (rows) =>
    rows?.map((n) => (n.readAt === null && isMarked(n) ? { ...n, readAt: now } : n)),
  );
  return { marked: true };
}

/** Saving failed, or there was no list to mark yet: read the list again so it shows what is true. */
const readAgainUnlessMarked = (client: QueryClient) => (_data: unknown, error: Error | null, _vars: unknown, result: { marked: boolean } | undefined) => {
  if (error || !result?.marked) void client.invalidateQueries({ queryKey: notificationKeys.list() });
};

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
    onSettled: readAgainUnlessMarked(client),
  });

const markAllNotificationsReadMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: () => api.notifications.markAllRead(),
    onMutate: () => markInCache(client, () => true),
    onSettled: readAgainUnlessMarked(client),
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
