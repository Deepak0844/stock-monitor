import { keepPreviousData, mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, Mapping, MappingFilter, MappingInput, Page } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey, entityKey, listKey, pageKey } from "../apiUtils.js";
import { shopifyKeys } from "../shopify/shopifyApi.js";

// Links between Shopify variants and supplier pages: every cached read and the changes that keep it right. Checks and whole
// supplier runs are followed by the pages themselves; their answers come back in through useMappingChanged or a re-read.

// Key type.
const MAPPING = "Mapping";

export type MappingPageQuery = Parameters<Api["mappings"]["page"]>[0];
export type MappingPatch = Parameters<Api["mappings"]["update"]>[1];

export const mappingKeys = {
  all: allKey(MAPPING),
  lists: () => listKey(MAPPING),
  // Every link matching a filter, for counts and the stock rules page.
  list: (filter: MappingFilter = {}) => [...listKey(MAPPING), "all", filter] as const,
  page: (query: MappingPageQuery) => pageKey(MAPPING, query),
  detail: (id: string) => entityKey(MAPPING, id),
  // Shopify variants that have no link yet.
  unmapped: (search = "") => [...allKey(MAPPING), "unmapped", search] as const,
  unmappedAll: () => [...allKey(MAPPING), "unmapped"] as const,
};

const isPage = (data: unknown): data is Page<Mapping> => typeof data === "object" && data !== null && "items" in data;

/** The server answered with a link: show that answer wherever the link is cached. */
function mappingChanged(client: QueryClient, next: Mapping) {
  client.setQueryData(mappingKeys.detail(next.id), next);
  const swap = (m: Mapping) => (m.id === next.id ? next : m);
  client.setQueriesData<Mapping[] | Page<Mapping>>({ queryKey: mappingKeys.lists() }, (data) =>
    Array.isArray(data) ? data.map(swap) : isPage(data) ? { ...data, items: data.items.map(swap) } : data,
  );
  // A filtered page may no longer hold it: read the lists again when they are next shown.
  void client.invalidateQueries({ queryKey: mappingKeys.lists(), refetchType: "none" });
}

/** Links were added or deleted: the lists on screen and the variants without a link are read again, and Products when next shown. */
function mappingsAddedOrRemoved(client: QueryClient) {
  void client.invalidateQueries({ queryKey: mappingKeys.lists() });
  void client.invalidateQueries({ queryKey: mappingKeys.unmappedAll() });
  void client.invalidateQueries({ queryKey: shopifyKeys.lists(), refetchType: "none" });
}

function mappingRemoved(client: QueryClient, id: string) {
  client.removeQueries({ queryKey: mappingKeys.detail(id), exact: true });
  mappingsAddedOrRemoved(client);
}

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getMappingListQuery = (api: Api, filter: MappingFilter) =>
  queryOptions({
    queryKey: mappingKeys.list(filter),
    queryFn: () => api.mappings.list(filter),
  });

const getMappingPageQuery = (api: Api, query: MappingPageQuery) =>
  queryOptions({
    queryKey: mappingKeys.page(query),
    queryFn: () => api.mappings.page(query),
    // The rows shown stay while the next page loads.
    placeholderData: keepPreviousData,
  });

const getMappingQuery = (api: Api, id: string) =>
  queryOptions({
    queryKey: mappingKeys.detail(id),
    queryFn: () => api.mappings.get(id),
  });

const getUnmappedQuery = (api: Api, search?: string) =>
  queryOptions({
    queryKey: mappingKeys.unmapped(search),
    queryFn: () => api.mappings.unmapped(search || undefined),
  });

const createMappingMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: (input: MappingInput) => api.mappings.create(input),
    onSuccess: () => mappingsAddedOrRemoved(client),
  });

const updateMappingMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id, patch }: { id: string; patch: MappingPatch }) => api.mappings.update(id, patch),
    onSuccess: (next) => {
      mappingChanged(client, next);
      void client.invalidateQueries({ queryKey: shopifyKeys.lists(), refetchType: "none" });
    },
  });

const removeMappingMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id }: { id: string }) => api.mappings.remove(id),
    onSuccess: (_result, { id }) => mappingRemoved(client, id),
  });

// Starts a check of one link's page or stock; the page follows it and reads the link once it has finished.
const checkMappingLinkMutation = (api: Api) =>
  mutationOptions({
    mutationFn: ({ id }: { id: string }) => api.mappings.checkLink(id),
  });

const checkMappingStockMutation = (api: Api) =>
  mutationOptions({
    mutationFn: ({ id }: { id: string }) => api.stock.checkLink(id),
  });

const importMappingsMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: (previewId: string) => api.mappings.importConfirm(previewId),
    onSuccess: () => mappingsAddedOrRemoved(client),
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

export function useGetMappingListQuery(filter: MappingFilter = {}) {
  return useQuery(getMappingListQuery(useApi(), filter));
}

export function useGetMappingPageQuery(query: MappingPageQuery) {
  return useQuery(getMappingPageQuery(useApi(), query));
}

export function useGetMappingQuery(id: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...getMappingQuery(useApi(), id), enabled });
}

export function useGetUnmappedQuery(search?: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...getUnmappedQuery(useApi(), search), enabled });
}

/** Reads the variants without a link through the cache, for a search box that asks as the owner types. */
export function useFetchUnmapped() {
  const api = useApi();
  const client = useQueryClient();
  return (search?: string) => client.fetchQuery(getUnmappedQuery(api, search));
}

export function useCreateMappingMutation() {
  return useMutation(createMappingMutation(useApi(), useQueryClient()));
}

export function useUpdateMappingMutation() {
  return useMutation(updateMappingMutation(useApi(), useQueryClient()));
}

export function useRemoveMappingMutation() {
  return useMutation(removeMappingMutation(useApi(), useQueryClient()));
}

export function useCheckMappingLinkMutation() {
  return useMutation(checkMappingLinkMutation(useApi()));
}

export function useCheckMappingStockMutation() {
  return useMutation(checkMappingStockMutation(useApi()));
}

export function useImportMappingsMutation() {
  return useMutation(importMappingsMutation(useApi(), useQueryClient()));
}

/** Shows a link the server sent back outside these hooks (such as after a finished check) wherever it is cached. */
export function useMappingChanged() {
  const client = useQueryClient();
  return (next: Mapping) => mappingChanged(client, next);
}

/** Shows in the cache a delete sent straight to the server, such as one sent while the page closes. */
export function useMappingRemoved() {
  const client = useQueryClient();
  return (id: string) => mappingRemoved(client, id);
}

/** A whole supplier run ended: the links on screen are read again for the new answers, and Products when next shown. */
export function useMappingsRefresh() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: mappingKeys.lists() });
    void client.invalidateQueries({ queryKey: shopifyKeys.lists(), refetchType: "none" });
  };
}
