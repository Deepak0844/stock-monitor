import type { ReactElement } from "react";
import { notifyManager, QueryClient } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { Api } from "../api.js";
import { StoreProvider } from "../store/StoreProvider.js";

// Updates reach components in a microtask instead of a timer, so act() and the checks after it see them.
notifyManager.setScheduler(queueMicrotask);

// Renders with a new, empty cache each time, so no test sees another test's data. No retries: a failure shows at once.
export function renderWithStore(ui: ReactElement, { api }: { api: Api }): RenderResult & { client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <StoreProvider api={api} client={client}>
      {ui}
    </StoreProvider>,
  );
  return { ...result, client };
}
