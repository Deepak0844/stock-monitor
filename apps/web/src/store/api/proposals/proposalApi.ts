import { mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, ProposalSettings } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey } from "../apiUtils.js";

// Stock suggestions: every cached read and save. Pages use the hooks at the bottom and never build keys themselves.

// Key type.
const PROPOSAL = "Proposal";

export const proposalKeys = {
  all: allKey(PROPOSAL),
  // One settings record, so a key of its own rather than a list or item key.
  settings: () => [...allKey(PROPOSAL), "settings"] as const,
};

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getProposalSettingsQuery = (api: Api) =>
  queryOptions({
    queryKey: proposalKeys.settings(),
    queryFn: () => api.proposals.settings(),
  });

const saveProposalSettingsMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: (settings: ProposalSettings) => api.proposals.saveSettings(settings),
    // The server answers with the saved settings, so write them into the cache instead of asking again.
    // To refetch instead: client.invalidateQueries({ queryKey: proposalKeys.settings() }).
    onSuccess: (result) => client.setQueryData(proposalKeys.settings(), result),
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

export function useGetProposalSettingsQuery() {
  return useQuery(getProposalSettingsQuery(useApi()));
}

export function useSaveProposalSettingsMutation() {
  return useMutation(saveProposalSettingsMutation(useApi(), useQueryClient()));
}
