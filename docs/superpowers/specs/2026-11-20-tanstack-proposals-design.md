# Proposals on TanStack Query: design

Date: 2026-11-20. Size: small change. Follows the pilot (`2026-11-20-tanstack-query-pilot-design.md`) and its `store/` structure.

## Intent

The owner saw proposals fetched on every visit. Proposals, the menu badge and the Dashboard's waiting card read from one cache instead.

## Goals

- Back on Proposals within 30 s: cached list, no request. After 30 s: cached list at once, refreshed in the background.
- One count in the cache for the menu badge and the Dashboard. A page change refetches it only when older than 30 s.
- Approve or reject anywhere updates every cached open list and the counts.

## Non-goals

- Supplier list (next module), notifications, `api.ts`, wording.

## Anti-goals

- Losing: the 5 s re-read while something waits for Shopify, reject with Undo, bulk approve in turn, edited numbers, "finished" notice.

## Approaches

One sensible way: hooks in `store/api/proposals/proposalApi.ts` like the pilot. Keeping the page on `useEffect` with a hand-made shared store would rebuild what the cache already does.

## Design

- Keys: `["Proposal","list",{tab:"open",...query}]`, `["Proposal","list",{tab:"history",...}]`, `["Proposal","count","open"]`, `["Proposal","count","bySupplier"]`.
- Reads: `useGetProposalOpenListQuery(query, { poll })` (refetchInterval 5 s while an approved row is in it; Dashboard passes `poll: false`), `useGetProposalHistoryQuery` (keeps the previous page while the next loads), `useGetProposalCountQuery({ enabled })`, `useGetProposalWaitingBySupplierQuery()`. Each open-list read refreshes the counts, as today.
- Changes: `useApproveProposalMutation`, `useRejectProposalMutation` write the answer into every cached open list (replace if open/approved, else remove and total − 1), read a list again when it became empty but more remain, mark history lists stale and refresh counts. `useRefreshProposalMutation` changes no cache (the server works on it afterwards).
- `App` becomes a shell that makes the cache and renders `AppRoutes` inside `StoreProvider`; `AppRoutes` reads the badge count from the cache. `ProposalsPage` loses `onChange`.
- Screen state (hidden-with-Undo, ticked rows, bulk progress, typed numbers, refreshing rows) stays in `useState`.
