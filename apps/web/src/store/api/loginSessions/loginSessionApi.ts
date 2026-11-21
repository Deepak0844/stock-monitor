import { mutationOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { supplierKeys } from "../suppliers/supplierApi.js";

// Login windows: a live browser window where the owner logs in to a supplier by hand. Opening, saving and closing one are
// actions, not data to keep, so there are no reads here. Closing while the page itself closes stays api.loginSessions
// .cancelOnLeave, which must leave at once.

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const startLoginMutation = (api: Api) =>
  mutationOptions({
    mutationFn: (supplierId: string) => api.loginSessions.start(supplierId),
  });

const finishLoginMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id }: { supplierId: string; id: string }) => api.loginSessions.finish(id),
    // The supplier is connected now: it is read again, and every list showing it when next shown.
    onSuccess: (_result, { supplierId }) => {
      void client.invalidateQueries({ queryKey: supplierKeys.detail(supplierId), exact: true });
      void client.invalidateQueries({ queryKey: supplierKeys.lists(), refetchType: "none" });
    },
  });

const cancelLoginMutation = (api: Api) =>
  mutationOptions({
    mutationFn: (id: string) => api.loginSessions.cancel(id),
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

export function useStartLoginMutation() {
  return useMutation(startLoginMutation(useApi()));
}

export function useFinishLoginMutation() {
  return useMutation(finishLoginMutation(useApi(), useQueryClient()));
}

export function useCancelLoginMutation() {
  return useMutation(cancelLoginMutation(useApi()));
}
