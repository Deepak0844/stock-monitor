# TanStack Query pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Stock suggestion settings card reads and saves through a TanStack Query cache, inside a `src/query/` structure the rest of the app can adopt later.

**Architecture:** `api.ts` stays the fetch layer. `src/query/` adds one client config, an `ApiProvider` context so hooks reach the same `api` `App` receives, a key factory, and one hooks file per resource. `App` wraps its tree in both providers.

**Tech Stack:** React 19, `@tanstack/react-query` v5, Vitest + Testing Library, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-20-tanstack-query-pilot-design.md`

## Global Constraints

- Use npm: `npm install @tanstack/react-query -w @stock-monitor/web`.
- `api.ts` unchanged. No other page or component changes beyond the card, `SuggestionsPage` and `App`.
- Owner-facing text, loading skeleton, errors and the "Saved." toast stay exactly as they are.
- Queries: `staleTime` 30 s; retry up to 2 times only for network errors (`ApiError` status 0) and 5xx; never for 4xx. Mutations: no retry.
- Each new file carries a short comment naming the RTK Query equivalent.
- Commits: conventional type, no Claude attribution.

## Review Focus

- Settings fail to load (4xx): error shows at once, no retry delay. Covered by the existing "load error" card test, which must pass with the test helper's client.
- Save fails: error shows, form keeps the owner's typed values. Card test.
- Save succeeds: permission notice shows the server's new answer (from the cache, not local state). Card test.
- Leaving and reopening the page within 30 s: shows cached data with no second request. Hook test.
- Tests leaking cache between tests: helper makes a fresh `QueryClient` per render.

---

### Task 1: Query infrastructure

**Files:**
- Create: `apps/web/src/query/client.ts`, `apps/web/src/query/ApiProvider.tsx`, `apps/web/src/query/keys.ts`, `apps/web/src/test/renderWithQuery.tsx`
- Test: `apps/web/src/query/client.test.ts`
- Modify: `apps/web/package.json` (dependency)

**Interfaces:**
- Produces: `createQueryClient(): QueryClient`; `shouldRetry(failureCount: number, error: unknown): boolean`; `ApiProvider({ api, children })`; `useApi(): Api` (throws outside the provider); `queryKeys.proposals.all` = `["proposals"]`, `queryKeys.proposals.settings()` = `["proposals", "settings"]`; `renderWithQuery(ui, { api }): RenderResult & { client: QueryClient }` (fresh client, retries off).

- [ ] **Step 1:** Install the dependency.
- [ ] **Step 2: Failing tests** in `client.test.ts`: `shouldRetry(0, new ApiError("x", 0))` true; `shouldRetry(1, new ApiError("x", 503))` true; `shouldRetry(2, new ApiError("x", 503))` false; `shouldRetry(0, new ApiError("x", 404))` false; `createQueryClient().getDefaultOptions().queries?.staleTime` is `30_000`; mutations `retry` is `false`.
- [ ] **Step 3:** Run `npx vitest run apps/web/src/query` — FAIL (module missing).
- [ ] **Step 4:** Implement the four files.
- [ ] **Step 5:** Run again — PASS. Commit `feat: TanStack Query client, api provider and cache keys`.

### Task 2: Settings card on the cache

**Files:**
- Create: `apps/web/src/query/proposals.ts`, test `apps/web/src/query/proposals.test.tsx`
- Modify: `apps/web/src/pages/settings/ProposalSettingsCard.tsx`, its test, `apps/web/src/pages/settings/SuggestionsPage.tsx`, `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `useProposalSettings()` (`useQuery` on `queryKeys.proposals.settings()`); `useSaveProposalSettings()` (`useMutation`, `onSuccess` → `setQueryData(queryKeys.proposals.settings(), result)`). `ProposalSettingsCard()` and `SuggestionsPage()` take no props.

- [ ] **Step 1: Failing hook test:** two components using `useProposalSettings()` under one client call `api.proposals.settings` once; after `useSaveProposalSettings().mutateAsync(...)`, the cached value equals the save result.
- [ ] **Step 2:** Switch card tests to `renderWithQuery(<ProposalSettingsCard />, { api })`; add: save failure keeps typed values and shows the error; after save the permission notice shows the new `writePermission`. Run — FAIL.
- [ ] **Step 3:** Implement hooks; refactor card into outer (query states) + inner `SettingsForm` (fields in `useState`, seeded once from data); drop `api` props; wrap `App` in `QueryClientProvider` (client from `useState(createQueryClient)`) + `ApiProvider`.
- [ ] **Step 4:** Run `npm run check` — PASS. Commit `feat: suggestion settings read and save through TanStack Query`.

### Task 3: Verify in the running app

- [ ] Rebuild local app: `docker compose build api && docker compose up -d --no-deps api`; `curl http://127.0.0.1:3000/health` returns ok.
- [ ] Push branch, open PR to `develop` with detailed description. Do not merge.
