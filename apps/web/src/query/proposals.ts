import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProposalSettings } from "../api.js";
import { useApi } from "./ApiProvider.js";
import { queryKeys } from "./keys.js";

// Hooks for stock suggestions. Pages call these and never build keys or call api.proposals for cached data themselves.
// RTK Query: baseApi.injectEndpoints({ endpoints: (b) => ({ getProposalSettings: b.query(...), saveProposalSettings: b.mutation(...) }) }).

/** RTK Query: useGetProposalSettingsQuery(). */
export function useProposalSettings() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.proposals.settings(),
    queryFn: () => api.proposals.settings(),
  });
}

/** RTK Query: useSaveProposalSettingsMutation(). */
export function useSaveProposalSettings() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: ProposalSettings) => api.proposals.saveSettings(settings),
    // The server answers with the saved settings, so write them into the cache instead of asking again.
    // RTK Query: dispatch(api.util.updateQueryData("getProposalSettings", undefined, () => result)) in onQueryStarted.
    // To refetch instead: client.invalidateQueries({ queryKey: queryKeys.proposals.settings() }) (RTK: invalidatesTags).
    onSuccess: (result) => client.setQueryData(queryKeys.proposals.settings(), result),
  });
}
