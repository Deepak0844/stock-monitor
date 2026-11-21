import { keepPreviousData, mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, Page, Supplier, SupplierInput } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey, entityKey, listKey, pageKey } from "../apiUtils.js";

// Suppliers: every cached read and the changes that keep it right. Pages use the hooks at the bottom.

// Key type.
const SUPPLIER = "Supplier";

export type SupplierPageQuery = Parameters<Api["suppliers"]["page"]>[0];

export const supplierKeys = {
  all: allKey(SUPPLIER),
  lists: () => listKey(SUPPLIER),
  // Every supplier at once, for pickers, filters and summaries.
  list: () => [...listKey(SUPPLIER), "all"] as const,
  page: (query: SupplierPageQuery) => pageKey(SUPPLIER, query),
  detail: (id: string) => entityKey(SUPPLIER, id),
};

const isPage = (data: unknown): data is Page<Supplier> => typeof data === "object" && data !== null && "items" in data;

/** The server answered with a supplier: show that answer wherever the supplier is cached. */
export function supplierChanged(client: QueryClient, next: Supplier) {
  client.setQueryData(supplierKeys.detail(next.id), next);
  const swap = (s: Supplier) => (s.id === next.id ? next : s);
  client.setQueriesData<Supplier[] | Page<Supplier>>({ queryKey: supplierKeys.lists() }, (data) =>
    Array.isArray(data) ? data.map(swap) : isPage(data) ? { ...data, items: data.items.map(swap) } : data,
  );
  // A filtered page may no longer hold it: read the lists again when they are next shown.
  void client.invalidateQueries({ queryKey: supplierKeys.lists(), refetchType: "none" });
}

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getSupplierListQuery = (api: Api) =>
  queryOptions({
    queryKey: supplierKeys.list(),
    queryFn: () => api.suppliers.list(),
  });

const getSupplierPageQuery = (api: Api, query: SupplierPageQuery) =>
  queryOptions({
    queryKey: supplierKeys.page(query),
    queryFn: () => api.suppliers.page(query),
    // The page shown stays while the next one loads.
    placeholderData: keepPreviousData,
  });

const getSupplierQuery = (api: Api, id: string) =>
  queryOptions({
    queryKey: supplierKeys.detail(id),
    queryFn: () => api.suppliers.get(id),
  });

const createSupplierMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: (input: SupplierInput) => api.suppliers.create(input),
    onSuccess: () => client.invalidateQueries({ queryKey: supplierKeys.lists() }),
  });

const updateSupplierMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SupplierInput> }) => api.suppliers.update(id, patch),
    onSuccess: (next) => supplierChanged(client, next),
  });

const setSupplierEnabledMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ supplier, enabled }: { supplier: Supplier; enabled: boolean }) =>
      enabled ? api.suppliers.resume(supplier.id) : api.suppliers.pause(supplier.id),
    onSuccess: (next) => supplierChanged(client, next),
  });

const removeSupplierMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id }: { id: string }) => api.suppliers.remove(id),
    onSuccess: (_result, { id }) => {
      client.removeQueries({ queryKey: supplierKeys.detail(id), exact: true });
      client.setQueryData<Supplier[]>(supplierKeys.list(), (list) => list?.filter((s) => s.id !== id));
      // Pages move up by one: read the one on screen again now.
      return client.invalidateQueries({ queryKey: supplierKeys.lists() });
    },
  });

// Starts a check; the supplier changes once it has finished, which the page watches for.
const checkSupplierSessionMutation = (api: Api) =>
  mutationOptions({
    mutationFn: ({ id }: { id: string }) => api.suppliers.checkSession(id),
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

export function useGetSupplierListQuery() {
  return useQuery(getSupplierListQuery(useApi()));
}

export function useGetSupplierPageQuery(query: SupplierPageQuery) {
  return useQuery(getSupplierPageQuery(useApi(), query));
}

export function useGetSupplierQuery(id: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...getSupplierQuery(useApi(), id), enabled });
}

/** Reads one supplier through the cache, for code that needs it before going on (such as opening a login window). */
export function useFetchSupplier() {
  const api = useApi();
  const client = useQueryClient();
  return (id: string) => client.fetchQuery(getSupplierQuery(api, id));
}

export function useCreateSupplierMutation() {
  return useMutation(createSupplierMutation(useApi(), useQueryClient()));
}

export function useUpdateSupplierMutation() {
  return useMutation(updateSupplierMutation(useApi(), useQueryClient()));
}

export function useSetSupplierEnabledMutation() {
  return useMutation(setSupplierEnabledMutation(useApi(), useQueryClient()));
}

export function useRemoveSupplierMutation() {
  return useMutation(removeSupplierMutation(useApi(), useQueryClient()));
}

export function useCheckSupplierSessionMutation() {
  return useMutation(checkSupplierSessionMutation(useApi()));
}

/** Shows a supplier the server sent back outside these hooks (such as after a finished check) wherever it is cached. */
export function useSupplierChanged() {
  const client = useQueryClient();
  return (next: Supplier) => supplierChanged(client, next);
}

/** A card changed a supplier: read it again now, and the lists when they are next shown. */
export function useSupplierRefresh() {
  const client = useQueryClient();
  return (id: string) => {
    void client.invalidateQueries({ queryKey: supplierKeys.detail(id), exact: true });
    void client.invalidateQueries({ queryKey: supplierKeys.lists(), refetchType: "none" });
  };
}
