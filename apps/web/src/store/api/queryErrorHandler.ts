import { toast } from "../../lib/toast.js";

// What happens to every failed read or save, in one place.
// RTK Query: rtkQueryErrorMiddleware, which catches rejected actions and reads the endpoint's onError flags.
// Here the flags travel as the query's or mutation's `meta`.

export type ErrorMeta = {
  /** Show the error as a toast as well. Off by default: pages show their own errors next to what failed. */
  showToaster?: boolean;
  /** Never show a toast for this call, whatever else is set. */
  suppressGlobalError?: boolean;
};

// Lets useQuery({ meta }) and useMutation({ meta }) check these flags' types.
declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: ErrorMeta;
    mutationMeta: ErrorMeta;
  }
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export function handleQueryError(error: unknown, meta: ErrorMeta | undefined): void {
  if (!meta?.showToaster || meta.suppressGlobalError) return;
  toast(error instanceof Error ? error.message : GENERIC_MESSAGE, { kind: "error" });
}
