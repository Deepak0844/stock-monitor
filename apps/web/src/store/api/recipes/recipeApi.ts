import { mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, Recipe } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey, entityKey } from "../apiUtils.js";
import { mappingKeys } from "../mappings/mappingApi.js";
import { supplierKeys } from "../suppliers/supplierApi.js";

// Stock rules: the saved versions of a supplier's rules, and saving, turning on and deleting them. Testing rules and asking for
// suggestions are checks, not data to keep, so they stay plain calls on api.recipes.

// Key type.
const RECIPE = "Recipe";

export const recipeKeys = {
  all: allKey(RECIPE),
  versions: (supplierId: string) => [...entityKey(RECIPE, supplierId), "versions"] as const,
};

const readVersionsAgain = (client: QueryClient, supplierId: string) =>
  client.invalidateQueries({ queryKey: recipeKeys.versions(supplierId) });

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getRecipeVersionsQuery = (api: Api, supplierId: string) =>
  queryOptions({
    queryKey: recipeKeys.versions(supplierId),
    queryFn: () => api.recipes.list(supplierId),
  });

const saveRecipeMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ supplierId, recipe }: { supplierId: string; recipe: Recipe }) => api.recipes.save(supplierId, recipe),
    onSuccess: (_saved, { supplierId }) => readVersionsAgain(client, supplierId),
  });

const activateRecipeMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id }: { supplierId: string; id: string }) => api.recipes.activate(id),
    onSuccess: (_version, { supplierId }) => {
      // Stock answers now come from this version: the supplier and its links are read again when next shown.
      void client.invalidateQueries({ queryKey: supplierKeys.detail(supplierId), refetchType: "none" });
      void client.invalidateQueries({ queryKey: supplierKeys.lists(), refetchType: "none" });
      void client.invalidateQueries({ queryKey: mappingKeys.lists(), refetchType: "none" });
      return readVersionsAgain(client, supplierId);
    },
  });

const removeRecipeMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ id }: { supplierId: string; id: string }) => api.recipes.remove(id),
    onSuccess: (_result, { supplierId }) => readVersionsAgain(client, supplierId),
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

export function useGetRecipeVersionsQuery(supplierId: string) {
  return useQuery(getRecipeVersionsQuery(useApi(), supplierId));
}

export function useSaveRecipeMutation() {
  return useMutation(saveRecipeMutation(useApi(), useQueryClient()));
}

export function useActivateRecipeMutation() {
  return useMutation(activateRecipeMutation(useApi(), useQueryClient()));
}

export function useRemoveRecipeMutation() {
  return useMutation(removeRecipeMutation(useApi(), useQueryClient()));
}
