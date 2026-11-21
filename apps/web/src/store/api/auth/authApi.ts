import { mutationOptions, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Api, Owner } from "../../../api.js";
import { useApi } from "../baseQuery.js";
import { allKey } from "../apiUtils.js";

// Signing in and out, and who is signed in now.

// Key type.
const AUTH = "Auth";

export const authKeys = {
  all: allKey(AUTH),
  // The signed-in owner, or null when nobody is signed in.
  me: () => [...allKey(AUTH), "me"] as const,
};

// ---------------------------------------------------------------------------
// Endpoint definitions.
// ---------------------------------------------------------------------------

const getMeQuery = (api: Api) =>
  queryOptions({
    queryKey: authKeys.me(),
    queryFn: () => api.getMe(),
    // Read once when the app opens; signing in and out change it. A server that cannot be reached says so at once.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

const loginMutation = (api: Api, client: QueryClient) =>
  mutationOptions({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.login(email, password),
    onSuccess: (owner) => client.setQueryData<Owner | null>(authKeys.me(), owner),
  });

const logoutMutation = (api: Api, client: QueryClient, onSignedOut?: () => void) =>
  mutationOptions({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      // First the page moves (for example to /login), so the app never sees "nobody signed in" on the old address.
      onSignedOut?.();
      // Nothing cached for this session is shown after signing out. Who is signed in is kept, and set to nobody, so the app
      // watching it moves to the sign-in page.
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH });
      client.setQueryData<Owner | null>(authKeys.me(), null);
    },
  });

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

export function useGetMeQuery() {
  return useQuery(getMeQuery(useApi()));
}

export function useLoginMutation() {
  return useMutation(loginMutation(useApi(), useQueryClient()));
}

/** `onSignedOut` runs once the server has ended the session, just before the cache says nobody is signed in. */
export function useLogoutMutation({ onSignedOut }: { onSignedOut?: () => void } = {}) {
  return useMutation(logoutMutation(useApi(), useQueryClient(), onSignedOut));
}

/** Checks the session afresh: what was cached is dropped first, so the app shows loading until the server answers. */
export function useCheckSessionAgain() {
  const client = useQueryClient();
  return () => client.resetQueries({ queryKey: authKeys.me() });
}
