import { keepPreviousData, mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type Query, type QueryClient } from "@tanstack/react-query";
import type { Api, Proposal, ProposalSettings } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey, listKey, pageKey } from "../apiUtils.js";

// Stock suggestions: every cached read and save. Pages use the hooks at the bottom and never build keys themselves.

// Key type.
const PROPOSAL = "Proposal";

export type OpenQuery = Parameters<Api["proposals"]["openPage"]>[0];
export type OpenPage = Awaited<ReturnType<Api["proposals"]["openPage"]>>;
export type HistoryQuery = { page: number; pageSize: number; supplierId?: string };

export const proposalKeys = {
  all: allKey(PROPOSAL),
  // One settings record, so a key of its own rather than a list or item key.
  settings: () => [...allKey(PROPOSAL), "settings"] as const,
  lists: () => listKey(PROPOSAL),
  open: (query: OpenQuery) => pageKey(PROPOSAL, { tab: "open", ...query }),
  history: (query: HistoryQuery) => pageKey(PROPOSAL, { tab: "history", ...query }),
  // Both counts come from one address, so they share a prefix and refresh together.
  counts: () => [...allKey(PROPOSAL), "count"] as const,
  count: () => [...proposalKeys.counts(), "open"] as const,
  waitingBySupplier: () => [...proposalKeys.counts(), "bySupplier"] as const,
};

/** While a suggestion waits for Shopify, its list is read again this often. */
export const POLL_MS = 5000;

const isTab = (tab: "open" | "history") => (query: Query) => (query.queryKey[2] as { tab?: string } | undefined)?.tab === tab;
const openLists = { queryKey: proposalKeys.lists(), predicate: isTab("open") };

/** A suggestion was approved or rejected: show the server's answer in every cached list and refresh the counts. */
async function decided(client: QueryClient, next: Proposal) {
  const stays = next.state === "open" || next.state === "approved";
  // A read already on its way would bring back the list from before this decision: stop it now and read again after.
  const onTheirWay = client
    .getQueryCache()
    .findAll(openLists)
    .filter((q) => q.state.fetchStatus === "fetching" && q.state.data !== undefined)
    .map((q) => q.queryKey);
  await Promise.all(onTheirWay.map((queryKey) => client.cancelQueries({ queryKey, exact: true })));
  const holding = new Set(
    client
      .getQueriesData<OpenPage>(openLists)
      .filter(([, page]) => page?.items.some((p) => p.id === next.id))
      .map(([key]) => JSON.stringify(key)),
  );
  client.setQueriesData<OpenPage>(openLists, (page) => {
    if (!page?.items.some((p) => p.id === next.id)) return page;
    return stays
      ? { ...page, items: page.items.map((p) => (p.id === next.id ? next : p)) }
      : { ...page, items: page.items.filter((p) => p.id !== next.id), total: page.total - 1 };
  });
  for (const [key, page] of client.getQueriesData<OpenPage>(openLists)) {
    // A page whose last row was just decided, while more are waiting: read it again to show the next ones.
    if (page && page.items.length === 0 && page.total > 0) void client.invalidateQueries({ queryKey: key, exact: true });
    // Other pages and filters move up by one after a reject: read them again when they are next shown.
    else if (!stays && !holding.has(JSON.stringify(key))) void client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
  }
  for (const queryKey of onTheirWay) void client.invalidateQueries({ queryKey, exact: true });
  // The decided one now belongs in History.
  void client.invalidateQueries({ queryKey: proposalKeys.lists(), predicate: isTab("history") });
  void client.invalidateQueries({ queryKey: proposalKeys.counts() });
}

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

const getProposalOpenListQuery = (api: Api, client: QueryClient, query: OpenQuery, poll: boolean) =>
  queryOptions({
    queryKey: proposalKeys.open(query),
    queryFn: async () => {
      const page = await api.proposals.openPage(query);
      // A new read can show new suggestions, so the counts in the menu and filter are read again with it.
      void client.invalidateQueries({ queryKey: proposalKeys.counts() });
      return page;
    },
    refetchInterval: (q) => (poll && q.state.data?.items.some((p) => p.state === "approved") ? POLL_MS : false),
  });

const getProposalHistoryQuery = (api: Api, query: HistoryQuery) =>
  queryOptions({
    queryKey: proposalKeys.history(query),
    queryFn: () => (query.supplierId ? api.proposals.history(query.page, query.pageSize, query.supplierId) : api.proposals.history(query.page, query.pageSize)),
    // The page shown stays while the next one loads.
    placeholderData: keepPreviousData,
  });

const getProposalCountQuery = (api: Api) =>
  queryOptions({
    queryKey: proposalKeys.count(),
    queryFn: () => api.proposals.count(),
  });

const getProposalWaitingBySupplierQuery = (api: Api) =>
  queryOptions({
    queryKey: proposalKeys.waitingBySupplier(),
    queryFn: () => api.proposals.waitingBySupplier(),
  });

const approveProposalMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id, quantity }: { id: string; quantity?: number }) => api.proposals.approve(id, quantity),
    onSuccess: (next) => decided(client, next),
  });

const rejectProposalMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id, keepalive }: { id: string; keepalive?: boolean }) => api.proposals.reject(id, { keepalive }),
    onSuccess: (next) => decided(client, next),
  });

// The server reads Shopify again afterwards, so nothing in the cache changes yet.
const refreshProposalMutation = (api: Api) =>
  mutationOptions({
    mutationFn: ({ id }: { id: string }) => api.proposals.refresh(id),
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

/** One page of suggestions waiting for the owner or for Shopify. `poll: false` turns off the re-read while one waits for Shopify. */
export function useGetProposalOpenListQuery(query: OpenQuery, { poll = true, enabled = true }: { poll?: boolean; enabled?: boolean } = {}) {
  return useQuery({ ...getProposalOpenListQuery(useApi(), useQueryClient(), query, poll), enabled });
}

export function useGetProposalHistoryQuery(query: HistoryQuery, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...getProposalHistoryQuery(useApi(), query), enabled });
}

export function useGetProposalCountQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...getProposalCountQuery(useApi()), enabled });
}

export function useGetProposalWaitingBySupplierQuery() {
  return useQuery(getProposalWaitingBySupplierQuery(useApi()));
}

export function useApproveProposalMutation() {
  return useMutation(approveProposalMutation(useApi(), useQueryClient()));
}

export function useRejectProposalMutation() {
  return useMutation(rejectProposalMutation(useApi(), useQueryClient()));
}

/** Shows in the cache a decision sent straight to the server, such as a reject sent while the page closes. */
export function useProposalDecided() {
  const client = useQueryClient();
  return (next: Proposal) => void decided(client, next);
}

export function useRefreshProposalMutation() {
  return useMutation(refreshProposalMutation(useApi()));
}
