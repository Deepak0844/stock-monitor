# TanStack Query pilot: design

Date: 2026-11-20. Size: small change.

## Intent

Try TanStack Query on one small module and set up a folder structure the rest of the web app can move into later, one module at a time. The owner knows RTK Query, so code and notes explain each TanStack idea next to its RTK Query equivalent.

## Goals

- Server data for the pilot module comes from a TanStack Query cache, not `useState` + `useEffect`.
- A structure that scales: one client config, one way for hooks to reach `api`, one file of cache keys, one hooks file per resource.
- Existing tests keep working; the pilot module's tests use a small render helper.

## Non-goals

- Moving any other page or component. They keep `api` as a prop for now.
- Changing `api.ts`. It stays the plain fetch layer.
- DevTools (can be added later as a dev-only import).

## Anti-goals

- The settings card behaves differently for the owner (wording, loading, errors, toast).
- Two ways to reach `api` that disagree: the provider gets the same `api` that `App` already receives.

## Approaches

1. **By resource (picked).** `src/query/` next to `api.ts`, one hooks file per resource, matching how `api.ts` is grouped. Nothing else moves.
2. **By feature.** `src/features/<name>/{api,queries,components}`. Common in large apps, but here it means moving pages and components and breaking the current `pages/` + `components/` layout. Too much for a pilot.
3. **RTK Query.** The owner knows it, but it needs a Redux store only for the cache. The owner chose TanStack Query.

## Design

Pilot module: Stock suggestion settings card (`pages/settings/ProposalSettingsCard.tsx`): one read (`api.proposals.settings()`), one save (`api.proposals.saveSettings()`), used on one page.

```
apps/web/src/
  api.ts                        unchanged
  query/
    client.ts                   createQueryClient(): shared defaults
    ApiProvider.tsx             ApiProvider + useApi()
    keys.ts                     every cache key
    proposals.ts                useProposalSettings, useSaveProposalSettings
  test/renderWithQuery.tsx      test helper: fresh client + ApiProvider
```

- `client.ts` (RTK: `createApi` options + `configureStore`): queries are fresh for 30 s, retry twice on network/5xx errors, never on 4xx. Mutations never retry.
- `ApiProvider.tsx` (RTK: the store's `extra` argument read in `queryFn`): React context holding the `Api`. `App` wraps its tree in `QueryClientProvider` + `ApiProvider api={api}`, so tests that pass a fake `api` to `App` still work.
- `keys.ts` (RTK: endpoint name + args, built for you; tags): a key factory, e.g. `queryKeys.proposals.settings()` → `["proposals", "settings"]`. Prefix `["proposals"]` invalidates all proposal data.
- `proposals.ts` (RTK: `injectEndpoints` + generated hooks): `useProposalSettings()` wraps `useQuery`; `useSaveProposalSettings()` wraps `useMutation` and on success writes the server's answer into the cache with `setQueryData` (RTK: `updateQueryData` in `onQueryStarted`).
- The card: data comes from `useProposalSettings()`. The form fields stay in `useState` (UI state), in an inner form component that mounts once the data is there, so no effect copies server data into the fields. The card and `SuggestionsPage` stop taking an `api` prop.

## Left to the builder

Exact retry count wording, test helper name, inline comments that give the RTK equivalent.
