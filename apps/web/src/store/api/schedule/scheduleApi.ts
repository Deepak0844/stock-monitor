import { mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, ScheduleRow } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey, entityKey } from "../apiUtils.js";
import { supplierChanged } from "../suppliers/supplierApi.js";

// Automatic checks: the schedule of every supplier, each supplier's past runs, and saving a schedule.

// Key type.
const SCHEDULE = "Schedule";

export type ScheduleInput = Parameters<Api["schedule"]["set"]>[1];

export const scheduleKeys = {
  all: allKey(SCHEDULE),
  // Every supplier's schedule and run, in one list.
  overview: () => [...allKey(SCHEDULE), "overview"] as const,
  runs: (supplierId: string) => [...entityKey(SCHEDULE, supplierId), "runs"] as const,
};

/** How often to read the schedule again: a fixed time, or worked out from what was last read. */
type RefetchEvery = number | false | ((rows: ScheduleRow[] | undefined) => number | false);

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getScheduleOverviewQuery = (api: Api) =>
  queryOptions({
    queryKey: scheduleKeys.overview(),
    queryFn: () => api.schedule.overview(),
  });

const getScheduleRunsQuery = (api: Api, supplierId: string) =>
  queryOptions({
    queryKey: scheduleKeys.runs(supplierId),
    queryFn: () => api.schedule.runs(supplierId),
  });

const setScheduleMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ supplierId, input }: { supplierId: string; input: ScheduleInput }) => api.schedule.set(supplierId, input),
    onSuccess: (supplier) => {
      supplierChanged(client, supplier);
      void client.invalidateQueries({ queryKey: scheduleKeys.overview() });
      void client.invalidateQueries({ queryKey: scheduleKeys.runs(supplier.id) });
    },
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

/** `refetchEvery` reads it again while the page is shown (never while the tab is hidden). */
export function useGetScheduleOverviewQuery({ enabled = true, refetchEvery = false }: { enabled?: boolean; refetchEvery?: RefetchEvery } = {}) {
  return useQuery({
    ...getScheduleOverviewQuery(useApi()),
    enabled,
    refetchInterval: typeof refetchEvery === "function" ? (q: { state: { data: ScheduleRow[] | undefined } }) => refetchEvery(q.state.data) : refetchEvery,
  });
}

export function useGetScheduleRunsQuery(supplierId: string) {
  return useQuery(getScheduleRunsQuery(useApi(), supplierId));
}

export function useSetScheduleMutation() {
  return useMutation(setScheduleMutation(useApi(), useQueryClient()));
}
