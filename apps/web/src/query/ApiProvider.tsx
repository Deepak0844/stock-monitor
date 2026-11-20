import { createContext, useContext, type ReactNode } from "react";
import type { Api } from "../api.js";

// Gives query hooks the api App was given: the real one, or a fake in tests.
// RTK Query: configureStore({ middleware: (g) => g({ thunk: { extraArgument: { api } } }) }), read in queryFn as `extra`.

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside <ApiProvider>.");
  return api;
}
