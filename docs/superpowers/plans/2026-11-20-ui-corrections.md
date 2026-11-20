# UI corrections, round 2: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, chosen for round 1 and kept). Steps use `- [ ]`.

**Goal:** build the seven corrections the owner approved in the preview.
**Architecture:** restyle existing pages in place; behaviour and API calls stay; tests guard behaviour.
**Tech stack:** React 19, Tailwind v4 tokens in `apps/web/src/theme.css`, radix, lucide, vitest, Playwright + axe.
**Spec:** `docs/superpowers/specs/2026-11-20-ui-corrections-design.md` (preview: `docs/superpowers/specs/2026-11-20-ui-corrections/preview.html`).

## Global constraints
- npm, not pnpm. No Claude attribution in commits or PRs. Never touch the owner's `.env`.
- Desktop 14px text / 32px controls; phone 16px / 44px. Text contrast 4.5:1, controls 3:1, both themes.
- After each task: `docker compose build api && docker compose up -d --no-deps api`, health check on 3000.
- Unit: `npm run test:unit` scoped to `apps/web`; e2e: `npm run test:e2e` at the end.

## Review focus
1. Phone 390px: no sideways scroll on every changed screen (axe sweep in `e2e/redesign.spec.ts`).
2. The supplier form's single save bar must save exactly the changed part and keep the others' unsaved edits.
3. The notification action buttons must go where the message is about (supplier connect page, link).
4. Theme menu must keep "Same as device" working after the toggle button is removed.
5. Filters sheet: chips and the sheet must stay in step with the URL filters.

## Tasks
1. **Brightness** — `theme.css` values from the spec; `theme.test.ts` gains the two page colours and keeps every contrast pair green.
2. **Top bar** — `shell/AppShell.tsx`, `shell/NotificationBell.tsx`, `shell/ThemeToggle.tsx` (moves into an account menu); tests: bell count badge, account menu shows email and the three theme choices and signs out; theme choice persists.
3. **Notification panel** — `shell/NotificationBell.tsx`; tests: kind icon, action link per kind, Today/Earlier groups, Unread tab filters, full-screen below 64rem.
4. **Phone layouts** — `MappingsPage.tsx`, `SuppliersPage.tsx`, `DashboardPage.tsx`, `components/FilterChips.tsx`, a `FilterSheet`; tests: Filters button count, sheet applies filters, chips remove one; e2e phone checks no sideways scroll and row height under 200px.
5. **Supplier form** — `SupplierFormPage.tsx` + its panels; tests: index lists parts with states, save bar saves only the changed part.
6. **Stock rules** — `StockRulesPage.tsx`, `RuleEditor.tsx`, `SavedPages.tsx`, `VersionList.tsx`; tests: step states, a rule renders as one row, examples column.
7. **Live window** — `ConnectSupplierPage.tsx`, `LiveWindow.tsx`; tests: address and Live sign, steps, time-left bar, phone bottom bar.
