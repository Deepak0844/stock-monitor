import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { Api } from "../api.js";
import { ApiContext } from "./api/baseQuery.js";

// Puts the cache and the api where every hook can reach them.
export function StoreProvider({ api, client, children }: { api: Api; client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}
