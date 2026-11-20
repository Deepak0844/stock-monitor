import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api.js";
import { handleQueryError } from "./queryErrorHandler.js";

// The cache's shared rules, in one place. Resources add their own endpoints in store/api/<resource>/<resource>Api.ts.

const MAX_RETRIES = 2;

/** Try again only when another try could work: the server was unreachable (status 0) or failed (5xx). A refusal (4xx) will not change. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // Every failure passes through one handler.
    queryCache: new QueryCache({ onError: (error, query) => handleQueryError(error, query.meta) }),
    mutationCache: new MutationCache({ onError: (error, _variables, _result, mutation) => handleQueryError(error, mutation.meta) }),
    defaultOptions: {
      // Data counts as fresh for 30 s: pages opened again in that time read the cache with no request.
      queries: { staleTime: 30_000, retry: shouldRetry },
      // A save is never sent twice by itself.
      mutations: { retry: false },
    },
  });
}
