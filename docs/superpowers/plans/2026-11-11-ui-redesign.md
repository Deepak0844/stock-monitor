# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `apps/web` to Tailwind v4 and shadcn/ui, restyle every page to the store's look, add server-side pagination, confirm modals, skeletons, button loaders and a notification bell.

**Architecture:** Shared parts first (theme, ui primitives, data table, confirm dialog, shell with bell), then server pagination, then pages one at a time with the Suppliers page as the reference. The hand-rolled router in `apps/web/src/router.tsx` stays. Existing unfiltered `list()` calls stay for dropdowns and the dashboard. New paged calls sit beside them.

**Tech Stack:** React 19, Vite 8, Tailwind v4 (`@tailwindcss/vite`), shadcn/ui (Radix, `class-variance-authority`, `tailwind-merge`, `clsx`, `lucide-react`, `sonner`), Fastify 5, Drizzle, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-ui-redesign-design.md`

## Global Constraints

- Repo is public: no supplier names or domains in code, tests, docs or fixtures. Use invented names on `.example` hosts.
- Use `npm`, never pnpm. Never read or edit the owner's `.env`. Tests use isolated Compose projects.
- No inline `style="..."` attributes in markup. Scripts stay `'self'` only. Only the style policy may be relaxed to `style-src 'self' 'unsafe-inline'`.
- Imports use the `.js` extension (NodeNext). Web code may also use the `@/` alias for `apps/web/src/` once Task 1 adds it.
- All visible text is British English (colour, authorise, cancelled, organisation).
- Palette: dark brown `#5B3420` (sidebar, banner), black primary buttons, orange `#E8873A` accent (never body text on white), white surfaces, status colours green, amber and red kept separate. Inter, 12px radius (`--radius: 0.75rem`). Text contrast at least 4.5:1 in both themes.
- Existing tests keep their intent. They query by role and text, so keep accessible names stable or update the test in the same task.
- Branch off `develop` (`feat/ui-redesign`). No Claude attribution in commits. PRs are detailed. Run `npm run check` before each commit that touches code.

## Review Focus

- A page number past the last page (bookmarked URL after deleting rows): show the last page, not an empty table.
- Deleting the only row on the last page: step back one page.
- Search text with `%`, `_`, quotes or very long input: no SQL error, no 500.
- `pageSize` of 0, negative, non-numeric or huge: server answers 400 or clamps to 100.
- Double click on a confirm button: one request only, button disabled with a spinner.
- A slow or failed list load: skeleton first, then a retryable error, never a blank page.
- Notification read state: unread count drops after "mark as read", and a re-raised open notification does not become unread again.
- Escape closes the modal and returns focus to the button that opened it.

---

### Task 1: Tailwind, shadcn setup, theme tokens, CSP

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `tsconfig.json`, `apps/web/src/main.tsx`, `apps/api/src/app.ts:75-81`
- Create: `apps/web/components.json`, `apps/web/src/lib/utils.ts`, `apps/web/src/theme.css`
- Test: `apps/api/src/app.test.ts` (existing file for headers; add a case there), `apps/web/src/lib/utils.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` in `apps/web/src/lib/utils.ts`; `@/` alias; CSS tokens `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--accent`, `--muted`, `--border`, `--destructive`, `--ring`, `--sidebar`, `--sidebar-foreground`, `--success`, `--warning`, `--radius`, defined for light and for `.dark` and `@media (prefers-color-scheme: dark)`.

- [ ] **Step 1: Write failing tests.** `cn("a", false && "b", "c")` returns `"a c"`; `cn("p-2", "p-4")` returns `"p-4"`. API test: the `content-security-policy` header contains `style-src 'self' 'unsafe-inline'` and still contains `default-src 'self'` and does not contain `script-src` with `unsafe-inline`.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/lib/utils.test.ts apps/api/src/app.test.ts`. Expected: FAIL.
- [ ] **Step 3: Install** in `apps/web`: `npm i -w @stock-monitor/web tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react sonner tw-animate-css` and the Radix packages each component needs (added as components are generated). Add the `tailwindcss()` plugin and `resolve.alias["@"]` to `vite.config.ts`. Add `compilerOptions.paths: { "@/*": ["apps/web/src/*"] }` to the root `tsconfig.json`. Add the same alias to the vitest config used for web tests.
- [ ] **Step 4: Implement** `cn` with `twMerge(clsx(inputs))`. Write `theme.css` with `@import "tailwindcss"; @import "tw-animate-css";`, the tokens above (Inter via the existing `@fontsource-variable/inter`), and `@theme inline` mapping tokens to Tailwind colours. Import it in `main.tsx` beside the old `styles.css`, which stays until Task 17. Create `components.json` for the shadcn CLI (style `new-york`, css `src/theme.css`, alias `@/components`, `@/lib/utils`).
- [ ] **Step 5: Change the header** in `SECURITY_HEADERS` to add `style-src 'self' 'unsafe-inline'`.
- [ ] **Step 6: Run** the two test files, then `npm run build -w @stock-monitor/web`. Expected: PASS and a build with no warnings.
- [ ] **Step 7: Browser check** (record the result in the PR): run the stack, open a page that mounts a Radix Dialog (Task 2 adds one, so do this check at the end of Task 2) and confirm the console has no CSP violation. If it fails, switch the modal to native `<dialog>` and say so in the PR.
- [ ] **Step 8: Commit** `feat(web): add Tailwind v4, shadcn setup and store theme tokens`.

### Task 2: shadcn primitives with the store style

**Files:**
- Create under `apps/web/src/components/ui/`: `button.tsx`, `input.tsx`, `select.tsx`, `badge.tsx`, `card.tsx`, `table.tsx`, `skeleton.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `tabs.tsx`, `sonner.tsx`
- Test: `apps/web/src/components/ui/ui.test.tsx`

**Interfaces:**
- Produces: `Button` with props `variant: "default" | "outline" | "ghost" | "destructive"`, `size: "sm" | "default" | "icon"`, and `loading?: boolean`. When `loading` is true it renders a spinner, sets `aria-busy="true"`, sets `disabled`, and keeps its label. `Skeleton` (`className`) with a CSS shimmer that stops under `prefers-reduced-motion`. `Badge` variants `success | warning | danger | neutral`. `Toaster` and `toast` from sonner for success messages only.

- [ ] **Step 1: Write failing tests:** `Button loading` is disabled, has `aria-busy="true"`, and does not call `onClick`; `Dialog` opens, Escape closes it and focus returns to the trigger; `Badge variant="warning"` renders its text.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/components/ui/ui.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Generate** the components with `npx shadcn@latest add <name>` from `apps/web`, then edit: primary button is black with white text, outline variant has a border, 12px radius, 2.5rem default height, 44px minimum touch target on `icon`.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then do the Task 1 Step 7 browser check.
- [ ] **Step 5: Commit** `feat(web): add shadcn primitives in the store style`.

### Task 3: List state in the URL, DataTable and Pager

**Files:**
- Create: `apps/web/src/lib/useListParams.ts`, `apps/web/src/components/DataTable.tsx`, `apps/web/src/components/Pager.tsx`, `apps/web/src/components/EmptyState.tsx`
- Modify: `apps/web/src/router.tsx` (add `useSearch()` and `setSearch(params: Record<string,string|undefined>)` that replaces the query string)
- Test: `apps/web/src/lib/useListParams.test.tsx`, `apps/web/src/components/DataTable.test.tsx`

**Interfaces:**
- Produces: `useListParams(defaults: { pageSize: number }): { page: number; pageSize: number; search: string; filters: Record<string,string>; set(patch: Partial<{ page: number; pageSize: number; search: string }> & Record<string,string|undefined>): void }`. Setting `search`, `pageSize` or any filter resets `page` to 1. Invalid values fall back to defaults (`page` below 1, non-numeric, `pageSize` not in `[10, 25, 50]`).
- `DataTable<T>(props: { columns: { header: string; cell(row: T): ReactNode; className?: string }[]; rows: T[] | null; rowKey(row: T): string; loading: boolean; error: string | null; onRetry(): void; empty: ReactNode; pageSize: number })`. While `loading` it renders `pageSize` skeleton rows and sets `aria-busy="true"` on the table wrapper. The wrapper scrolls sideways on narrow screens.
- `Pager(props: { page: number; pageSize: number; total: number; onPage(n: number): void; onPageSize(n: number): void })` shows "Showing 11–20 of 42" and previous, next and page buttons with `aria-current="page"`. If `page` is past the last page it calls `onPage(lastPage)` once.

- [ ] **Step 1: Write failing tests:** `?page=abc&pageSize=7` gives page 1 and the default size; `set({ search: "x" })` drops `page` to 1; `DataTable` shows skeleton rows while loading, an error with a Retry button that calls `onRetry`, and the `empty` node when `rows` is `[]`; `Pager` shows "Showing 11–20 of 42" for page 2, size 10, total 42, disables Previous on page 1, and calls `onPage(5)` for page 9 of 5 pages.
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement** to the signatures above. Search input debounce (300 ms) lives in the page, not the hook.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add URL list state, data table and pager`.

### Task 4: ConfirmDialog

**Files:**
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Test: `apps/web/src/components/ConfirmDialog.test.tsx`

**Interfaces:**
- Consumes: `Dialog`, `Button` from Task 2.
- Produces: `ConfirmDialog(props: { open: boolean; title: string; description: string; confirmLabel: string; onConfirm(): Promise<void>; onClose(): void })`. While `onConfirm` is pending the confirm button shows `loading` and Cancel and Escape are disabled. If `onConfirm` rejects, the dialog stays open and shows the error message under the description in an element with `role="alert"`.

- [ ] **Step 1: Write failing tests:** double click on confirm calls `onConfirm` once; a rejected `onConfirm("Could not delete")` shows that text with `role="alert"` and the dialog stays open; Escape calls `onClose` when idle.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/components/ConfirmDialog.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** on the shadcn `Dialog`, destructive variant for the confirm button.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add confirm dialog with loading and error states`.

### Task 5: Server pagination for suppliers

**Files:**
- Modify: `packages/db/src/supplier-repository.ts:60` (add `page`), `apps/api/src/routes/suppliers.ts:90`
- Test: `packages/db/src/supplier-repository.int.test.ts`, `apps/api/src/routes/suppliers.test.ts` (use the existing files for these modules)

**Interfaces:**
- Produces: `repo.page(query: { page: number; pageSize: number; search?: string; status?: "connected" | "needs_reconnect" | "blocked" | "paused" | "not_connected" }): Promise<{ items: SupplierRecord[]; total: number }>`, ordered like `list()`. Search matches name and website, case-insensitive, with `%`, `_` and `\` escaped. `GET /api/suppliers` with no `page` query keeps returning `{ suppliers }` for all rows. With `page` it returns `{ items, total, page, pageSize }`. Query validation with zod: `page` integer at least 1, `pageSize` integer 1 to 100; anything else is `400 invalid_input`.

- [ ] **Step 1: Write failing tests (int):** 25 suppliers, `page(2, 10)` returns items 11 to 20 and `total` 25; search `"50%"` matches only a name containing it; status `paused` filters. (route): `?page=0` is 400; `?page=1&pageSize=101` is 400; no params still returns every supplier under `suppliers`.
- [ ] **Step 2: Run** `npx vitest run packages/db/src/supplier-repository.int.test.ts apps/api/src/routes/suppliers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with one query for rows and one `count(*)` over the same `where`. Status mapping reuses the rule in `statusOf` from `SuppliersPage.tsx` (paused wins unless `pausedReason` is `session`); put the shared mapping next to the repo and test it there.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): page, search and filter suppliers on the server`.

### Task 6: Server pagination for links and proposals

**Files:**
- Modify: `packages/db/src/mapping-repository.ts:91`, `apps/api/src/routes/mappings.ts:84`, `packages/db/src/proposal-repository.ts`, `apps/api/src/routes/proposals.ts:93`
- Test: the matching `*.int.test.ts` and route tests

**Interfaces:**
- Produces: `mappings.page(filter: MappingFilter & { page: number; pageSize: number }): Promise<{ rows: MappingRow[]; total: number }>`. `GET /api/mappings` with no `page` is unchanged. With `page` it returns `{ mappings, total, page, pageSize }`, filters `supplierId`, `status`, `search` unchanged, same limits as Task 5. Proposals: `GET /api/proposals` accepts `pageSize` (1 to 100, default 25) for both tabs and returns `total` on both. The open tab is paged too; `hasMore` stays for history so existing tests pass.

- [ ] **Step 1: Write failing tests:** mappings page 2 of 12 rows at size 5 returns rows 6 to 10 and `total` 12; a bad `supplierId` still gives zero rows and `total` 0; proposals `?tab=open&page=2&pageSize=2` returns the second pair and `total`.
- [ ] **Step 2: Run** the test files. Expected: FAIL.
- [ ] **Step 3: Implement** following Task 5's pattern (one rows query, one count over the same `where`). Keep the observation and suggestion joins from `app.get("/api/mappings")` unchanged.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): page links and proposals on the server`.

### Task 7: Notification read state and mark-all-read

**Files:**
- Modify: `packages/db/src/notification-repository.ts`, `apps/api/src/routes/notifications.ts`
- Test: `packages/db/src/notification-repository.int.test.ts`, `apps/api/src/routes/notifications.test.ts`

**Interfaces:**
- Produces: `repo.markAllRead(): Promise<number>` (rows changed, open and unread only). `POST /api/notifications/read-all` returns `{ ok: true, count }`. `GET /api/notifications` unchanged: it already returns `readAt`.

- [ ] **Step 1: Write failing tests:** two unread open notifications, `markAllRead()` returns 2 and a second call returns 0; `raise` again on a read one keeps `readAt` set (existing behaviour, pin it); the route needs the owner session like the others.
- [ ] **Step 2: Run** the test files. Expected: FAIL.
- [ ] **Step 3: Implement** a single `update ... where resolved_at is null and read_at is null returning id`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): mark all notifications as read`.

### Task 8: Web API client and fake API

**Files:**
- Modify: `apps/web/src/api.ts` (types near lines 146, 283, 324, 369; implementations near 483, 553, 586, 592), `apps/web/src/test/fake-api.ts`
- Test: `apps/web/src/api.test.ts`

**Interfaces:**
- Consumes: Tasks 5 to 7 routes.
- Produces: `export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }`; `suppliers.page(q: { page: number; pageSize: number; search?: string; status?: string }): Promise<Page<Supplier>>`; `mappings.page(q: MappingFilter & { page: number; pageSize: number }): Promise<Page<Mapping>>`; `proposals.openPage(q: { page: number; pageSize: number }): Promise<Page<Proposal> & { writePermission: WritePermission }>` and `proposals.history(page: number, pageSize?: number)` returning `total` too; `notifications.markRead(id: string): Promise<void>`; `notifications.markAllRead(): Promise<void>`. Fake API gets matching `vi.fn()` members and builders `aSupplier`, `aMapping` already exist (reuse).

- [ ] **Step 1: Write failing tests:** each new call hits the right URL and query string (`/api/suppliers?page=2&pageSize=10&search=ab`) and maps the response; an empty `search` is left out.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the signatures; update `fake-api.ts` so every existing page test still compiles.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run apps/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add paged API calls and notification actions`.

### Task 9: App shell, breadcrumbs and notification bell

**Files:**
- Modify: `apps/web/src/shell/AppShell.tsx`, `apps/web/src/App.tsx:42`, `apps/web/src/shell/AppShell.test.tsx`
- Create: `apps/web/src/shell/Breadcrumbs.tsx`, `apps/web/src/shell/NotificationBell.tsx`, `apps/web/src/shell/useNotifications.ts`
- Test: `apps/web/src/shell/NotificationBell.test.tsx`, `apps/web/src/shell/Breadcrumbs.test.tsx`

**Interfaces:**
- Produces: `useNotifications(api): { items: AppNotification[]; unread: number; loading: boolean; markRead(id: string): Promise<void>; markAllRead(): Promise<void>; reload(): void }`, polling every 30 s and stopping when the tab is hidden. `Breadcrumbs(props: { items: { label: string; to?: string }[] })`, last item is `aria-current="page"`. Pages set crumbs through `useCrumbs(items)` from the shell context. Bell button name is `Notifications, N unread` (or `Notifications, none unread`). Each row links to the place that fixes it (reconnect goes to the supplier page, proposals to `/proposals`, recipe review to the supplier's rules page).

- [ ] **Step 1: Write failing tests:** the bell shows the unread count from `readAt: null` rows; opening it lists messages with relative time; clicking a row calls `markRead` and navigates; "Mark all as read" calls `markAllRead` and the name becomes `Notifications, none unread`; with no notifications it shows "You're all caught up."; Breadcrumbs render links for all but the last item.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** the shell in the store style: dark brown sidebar with an orange active marker, white top bar holding breadcrumbs, bell and theme toggle (stored in `localStorage` inside try/catch), proposal count badge kept from the current nav, mobile menu in a slide-over `Dialog`. The existing `attentionCount` and proposals count move into the shell.
- [ ] **Step 4: Run** `npx vitest run apps/web/src/shell`. Expected: PASS (existing `AppShell.test.tsx` updated where its queries changed).
- [ ] **Step 5: Commit** `feat(web): new app shell with breadcrumbs and notification bell`.

### Task 10: Suppliers page (the reference page)

**Files:**
- Modify: `apps/web/src/pages/SuppliersPage.tsx`, `apps/web/src/pages/SuppliersPage.test.tsx`
- Create: `apps/web/src/components/PageHeader.tsx`, `apps/web/src/components/StatTile.tsx`, `apps/web/src/components/StatusBadge.tsx`

**Interfaces:**
- Consumes: Tasks 2 to 4, 8, 9.
- Produces: `PageHeader(props: { title: string; description?: string; actions?: ReactNode })`; `StatTile(props: { label: string; value: number | null; to?: string; tone?: "default" | "warning" })` (skeleton when `value` is null, a link when `to` is set); `StatusBadge(props: { tone: "ok" | "warn" | "neutral"; children })`.

- [ ] **Step 1: Update the test first:** list calls `suppliers.page({ page: 1, pageSize: 10 })`; typing in search calls it again with `search` after the debounce and `page` 1; Next calls page 2; deleting asks in a dialog titled "Delete <name>?", the Delete supplier button shows a spinner, then the row is gone and a success toast shows; a failed delete shows the error inside the dialog; "Check now" shows a spinner until the check call resolves; tiles link to `/suppliers?status=needs_reconnect` and similar; loading shows skeleton rows; a load error shows Retry.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/pages/SuppliersPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Rebuild the page** with `PageHeader`, tiles, `DataTable`, `Pager` and `ConfirmDialog`, keeping `statusOf`, `ScheduleCell` and the progress polling logic as they are. The Name cell links to the supplier. Row actions beyond Check now sit in a dropdown (Edit, Connect, Rules, Delete).
- [ ] **Step 4: Run** the test and `npx vitest run apps/web`. Expected: PASS.
- [ ] **Step 5: Look at it** in a browser at 1440 and 390 wide, light and dark; compare with `suppliers-preview` (variant A) and fix alignment. Record what you checked in the PR.
- [ ] **Step 6: Commit** `feat(web): redesign suppliers page with paging and confirm dialog`.

### Task 11: Dashboard

**Files:**
- Modify: `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/DashboardPage.test.tsx`

- [ ] **Step 1: Update the test first:** four `StatTile`s (suppliers, links, open proposals, need attention) each link to its filtered list (`/suppliers?status=needs_reconnect`, `/proposals`, `/mappings?status=...`); an attention list shows open notifications with a link to fix each; skeleton tiles while loading; one failed section shows its own Retry without hiding the others.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Rebuild** with `PageHeader`, tiles and an attention card. Keep the current data calls (`suppliers.list()`, `mappings.unmapped()`, `mappings.list({})`).
- [ ] **Step 4: Run** `npx vitest run apps/web/src/pages/DashboardPage.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): redesign dashboard with linked tiles`.

### Task 12: Links pages

**Files:**
- Modify: `apps/web/src/pages/MappingsPage.tsx`, `MappingFormPage.tsx`, `ImportMappingsPage.tsx` and their tests

- [ ] **Step 1: Update the tests first:** the list uses `mappings.page`, search and supplier and status filters live in the URL, page resets on filter change; delete uses `ConfirmDialog`; "Check link" has a button loader; the form shows labels and errors under each field and a loading Save button; import shows a skeleton preview while parsing.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Rebuild** the three pages with the shared parts. Breadcrumbs: Links, Add link, Import links.
- [ ] **Step 4: Run** `npx vitest run apps/web/src/pages`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): redesign links pages with paging and confirm dialog`.

### Task 13: Proposals page

**Files:**
- Modify: `apps/web/src/pages/ProposalsPage.tsx`, `ProposalsPage.test.tsx`

- [ ] **Step 1: Update the test first:** Open and History are tabs with the page in the URL; both use the `Pager`; Approve and Reject have button loaders; Reject asks in a `ConfirmDialog`; editing the quantity stays inline; the permission notice stays visible.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Rebuild** using `proposals.openPage` and `proposals.history`.
- [ ] **Step 4: Run** `npx vitest run apps/web/src/pages/ProposalsPage.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): redesign proposals page`.

### Task 14: Products page

**Files:**
- Modify: `apps/web/src/pages/ProductsPage.tsx`, `ProductsPage.test.tsx`

- [ ] **Step 1: Update the test first:** same `DataTable` and `Pager`, search and "warnings only" filter in the URL, each product row links to its links, skeleton while loading.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Rebuild** keeping the existing `variants` call and warning icons.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): redesign products page`.

### Task 15: Settings, supplier forms, rules and connect

**Files:**
- Modify: `apps/web/src/pages/SettingsShopifyPage.tsx`, `settings/*.tsx`, `SupplierFormPage.tsx`, `ConnectSupplierPage.tsx`, `StockRulesPage.tsx`, `components/SchedulePanel.tsx`, `PermissionPanel.tsx`, `RuleEditor.tsx`, `LiveWindow.tsx`, `Notice.tsx` and their tests

- [ ] **Step 1: Update the tests first:** every Save and Connect button has a loader; the "Confirm delete" sub-panel in `StockRulesPage.tsx` becomes a `ConfirmDialog` (title "Delete this rule?"); Settings is a card layout with tabs or anchored sections; Shopify disconnect uses a dialog; `Notice` stays for in-page problems the owner must act on.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/pages apps/web/src/components`. Expected: FAIL.
- [ ] **Step 3: Rebuild** each with shared parts. The noVNC `LiveWindow` keeps its markup, only its frame and buttons change.
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): redesign settings, forms, rules and connect pages`.

### Task 16: Login and not found

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`, `NotFoundPage.tsx`, `apps/web/src/App.tsx:70`, their tests

- [ ] **Step 1: Update the tests first:** login keeps its labels, error under the form with `role="alert"` and a loading Sign in button; not found has a link back to the dashboard.
- [ ] **Step 2: Run** the two tests. Expected: FAIL.
- [ ] **Step 3: Rebuild** in the store style (centred card on the brown ground).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): redesign login and not found pages`.

### Task 17: Clean-up, British English, accessibility and end-to-end

**Files:**
- Delete: `apps/web/src/styles.css` and its import in `main.tsx`
- Modify: any file under `apps/web/src` with American spellings; `e2e/*.spec.ts` where selectors changed

- [ ] **Step 1: Find leftovers:** `grep -rniE "color|authoriz|organiz|canceled|center|behavior|favorite|license" apps/web/src --include=*.tsx --include=*.ts` and fix visible text only (not CSS properties, identifiers or API fields).
- [ ] **Step 2: Remove** `styles.css` and fix any class still relying on it.
- [ ] **Step 3: Run** `npm run check`. Expected: PASS.
- [ ] **Step 4: Run** `npm run test:e2e` (isolated Compose project, not the owner's stack). Update selectors only; behaviour must not change. Expected: PASS, including the existing axe checks.
- [ ] **Step 5: Manual pass** at 1440, 768 and 390 wide, light and dark, keyboard only on one page, and read every page aloud once for wording. List what you checked in the PR.
- [ ] **Step 6: Commit** `chore(web): remove old stylesheet and finish British English pass`.
