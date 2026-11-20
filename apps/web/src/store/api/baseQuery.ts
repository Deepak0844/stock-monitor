import { createContext, useContext } from "react";
import type { Api } from "../../api.js";

// How endpoints reach the server: through the api App was given (the real one, or a fake in tests).
// api.ts stays the fetch layer, so endpoints call api.<resource>.<call>().

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside <StoreProvider>.");
  return api;
}
