# Proposals on TanStack Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Proposals page, menu badge and Dashboard waiting card read and change proposals through the cache.
**Architecture:** Hooks in `apps/web/src/store/api/proposals/proposalApi.ts`; `App` split into shell + `AppRoutes`.
**Tech Stack:** React 19, @tanstack/react-query 5, Vitest.
**Spec:** `docs/superpowers/specs/2026-11-20-tanstack-proposals-design.md`

## Global Constraints

- Same text and behaviour on screen; `api.ts` unchanged; no RTK mentions in code or PR (owner rule).
- Poll every 5000 ms only while an approved row is in an open list on the Proposals page.

## Review Focus

- Two tabs/pages: approve on Dashboard, then open Proposals within 30 s: row shows as approved, not stale open. Hook test.
- Reject with Undo: nothing sent until the delay ends; Undo leaves the cache untouched. Existing page tests.
- Page beyond the end after deciding its last row: read once, not in a loop. Hook test.
- Signed out: no count request. App test.
- Count after a background list read: refreshed. Hook test.

---

### Task 1: Hooks
- Test: `store/api/proposals/proposalApi.test.tsx` — two readers of one open list make one request; approve answer replaces the row in a cached list; reject answer removes it and lowers total; an emptied list with more remaining is read once again; every open-list read refetches the counts; history marked stale after a decision.
- Code: keys + hooks above. Commit `feat: proposal lists and counts in the query cache`.

### Task 2: Pages
- Tests: `ProposalsPage.test.tsx` and `DashboardPage.test.tsx` render with `renderWithStore`; existing cases pass unchanged; new: Dashboard approve then the cached open list shows the row approved.
- Code: ProposalsPage (lists, counts, approve/reject/refresh via hooks; drop `onChange`), OpenItem (approve via mutation), DashboardPage (count + newest via hooks, `poll: false`), App shell + `AppRoutes` (badge from cache, `enabled: signedIn`, refetch stale count on page change). `npm run check`. Commit `feat: proposals page, badge and dashboard read from the cache`.

### Task 3: Ship
- Rebuild local 3000 from the worktree; push; PR into develop; do not merge.
