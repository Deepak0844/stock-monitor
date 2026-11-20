import { useCallback } from "react";
import { mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, CaptureDetail } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey, entityKey, listKey } from "../apiUtils.js";

// Saved pages: pictures of a supplier's pages, labelled with the stock answer the owner expects, used to test stock rules.

// Key type.
const CAPTURE = "Capture";

export type CaptureLabel = Parameters<Api["captures"]["label"]>[1];

export const captureKeys = {
  all: allKey(CAPTURE),
  list: (supplierId: string) => [...listKey(CAPTURE), supplierId] as const,
  detail: (id: string) => entityKey(CAPTURE, id),
};

const readListAgain = (client: QueryClient, supplierId: string) =>
  client.invalidateQueries({ queryKey: captureKeys.list(supplierId) });

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getCaptureListQuery = (api: Api, supplierId: string) =>
  queryOptions({
    queryKey: captureKeys.list(supplierId),
    queryFn: () => api.captures.list(supplierId),
  });

const getCaptureQuery = (api: Api, id: string) =>
  queryOptions({
    queryKey: captureKeys.detail(id),
    queryFn: () => api.captures.get(id),
  });

const requestCaptureMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ supplierId, mappingId }: { supplierId: string; mappingId: string }) => api.captures.request(supplierId, { mappingId }),
    onSuccess: (_capture, { supplierId }) => readListAgain(client, supplierId),
  });

const labelCaptureMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id, patch }: { supplierId: string; id: string; patch: CaptureLabel }) => api.captures.label(id, patch),
    onSuccess: (_capture, { supplierId, id, patch }) => {
      client.setQueryData<CaptureDetail>(captureKeys.detail(id), (d) =>
        d && {
          ...d,
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.expected === undefined ? {} : { expectedAnswer: patch.expected }),
        },
      );
      return readListAgain(client, supplierId);
    },
  });

const removeCaptureMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id }: { supplierId: string; id: string }) => api.captures.remove(id),
    onSuccess: (_result, { supplierId, id }) => {
      client.removeQueries({ queryKey: captureKeys.detail(id), exact: true });
      return readListAgain(client, supplierId);
    },
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

export function useGetCaptureListQuery(supplierId: string) {
  return useQuery(getCaptureListQuery(useApi(), supplierId));
}

/** Reads one saved page through the cache, when the owner picks it. The same function on every render. */
export function useFetchCapture() {
  const api = useApi();
  const client = useQueryClient();
  return useCallback((id: string) => client.fetchQuery(getCaptureQuery(api, id)), [api, client]);
}

export function useRequestCaptureMutation() {
  return useMutation(requestCaptureMutation(useApi(), useQueryClient()));
}

export function useLabelCaptureMutation() {
  return useMutation(labelCaptureMutation(useApi(), useQueryClient()));
}

export function useRemoveCaptureMutation() {
  return useMutation(removeCaptureMutation(useApi(), useQueryClient()));
}
