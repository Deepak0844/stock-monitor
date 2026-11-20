import { keepPreviousData, mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, ShopifyConnection, ShopifyDetails, VariantQuery } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey, listKey, pageKey } from "../apiUtils.js";

// Shopify: the store's connection, its locations and its products. Testing a connection is a check, not data to keep, so it
// stays a plain call on api.shopify.

// Key type.
const SHOPIFY = "Shopify";

export const shopifyKeys = {
  all: allKey(SHOPIFY),
  connection: () => [...allKey(SHOPIFY), "connection"] as const,
  locations: () => [...allKey(SHOPIFY), "locations"] as const,
  // Pages of the store's products, with what each one's supplier said.
  lists: () => listKey(SHOPIFY),
  variants: (query: VariantQuery) => pageKey(SHOPIFY, query),
};

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getShopifyConnectionQuery = (api: Api) =>
  queryOptions({
    queryKey: shopifyKeys.connection(),
    queryFn: () => api.shopify.getConnection(),
  });

const getShopifyLocationsQuery = (api: Api) =>
  queryOptions({
    queryKey: shopifyKeys.locations(),
    queryFn: () => api.shopify.locations(),
  });

const getShopifyVariantsQuery = (api: Api, query: VariantQuery) =>
  queryOptions({
    queryKey: shopifyKeys.variants(query),
    queryFn: () => api.shopify.variants(query),
    // The previous page stays on screen, dimmed, while the next one loads, so the page does not jump.
    placeholderData: keepPreviousData,
  });

const connectShopifyMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: (details: ShopifyDetails) => api.shopify.connect(details),
    onSuccess: (result) => {
      client.setQueryData(shopifyKeys.connection(), result.connection);
      // Possibly another store: its locations and products are read again.
      void client.invalidateQueries({ queryKey: shopifyKeys.locations() });
      void client.invalidateQueries({ queryKey: shopifyKeys.lists() });
    },
  });

const disconnectShopifyMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: () => api.shopify.disconnect(),
    onSuccess: () => {
      client.setQueryData<ShopifyConnection | null>(shopifyKeys.connection(), null);
      client.removeQueries({ queryKey: shopifyKeys.locations() });
      void client.invalidateQueries({ queryKey: shopifyKeys.lists() });
    },
  });

const chooseShopifyLocationMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: (id: string) => api.shopify.chooseLocation(id),
    onSuccess: (location) => {
      client.setQueryData<ShopifyConnection | null>(shopifyKeys.connection(), (c) =>
        c ? { ...c, locationId: location.id, locationName: location.name } : c,
      );
      // Stock numbers are read from the chosen location.
      void client.invalidateQueries({ queryKey: shopifyKeys.lists() });
    },
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

export function useGetShopifyConnectionQuery() {
  return useQuery(getShopifyConnectionQuery(useApi()));
}

export function useGetShopifyLocationsQuery() {
  return useQuery(getShopifyLocationsQuery(useApi()));
}

export function useGetShopifyVariantsQuery(query: VariantQuery) {
  return useQuery(getShopifyVariantsQuery(useApi(), query));
}

export function useConnectShopifyMutation() {
  return useMutation(connectShopifyMutation(useApi(), useQueryClient()));
}

export function useDisconnectShopifyMutation() {
  return useMutation(disconnectShopifyMutation(useApi(), useQueryClient()));
}

export function useChooseShopifyLocationMutation() {
  return useMutation(chooseShopifyLocationMutation(useApi(), useQueryClient()));
}

/** A sync finished: the connection and the products are read again. */
export function useShopifyRefresh() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: shopifyKeys.connection() });
    void client.invalidateQueries({ queryKey: shopifyKeys.lists() });
  };
}
