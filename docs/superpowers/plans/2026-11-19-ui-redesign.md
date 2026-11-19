# UI Redesign (Direction D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole web app to direction D ("Ledger"), in light and dark, with a designed phone layout. Add the components, extras and picked ideas the owner approved.

**Architecture:** Restyle in place, starting from the colour and font settings:
- Phases 1 to 3 change the theme settings, the shared components and the app frame, so every page shifts at once.
- Phases 4 to 8 rework tables and then pages.
- The server gets only two read-only additions: a recent-checks summary on `GET /api/schedule`, and sort settings on three paged lists.

Each phase is one feature branch off `develop` and one PR.

**Tech Stack:** React 19, Vite, Tailwind v4 (`@theme inline` in `apps/web/src/theme.css`), `radix-ui`, `lucide-react`, `class-variance-authority`, vitest with Testing Library, Fastify with zod (`apps/api`), Drizzle (`packages/db`), Playwright with axe (`e2e/`). npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-19-ui-redesign-design.md`. Mockups are in `docs/superpowers/specs/2026-11-19-ui-redesign/` (`pages.html` direction D, `components.html`, `screens.html`). Read the spec section named in each task before starting it.

## Global Constraints

- Colours exactly as in the spec's "Colours and fonts" table. Text contrast is at least 4.5:1 and control borders at least 3:1, in both themes. When a pair fails, change the value, never the rule.
- Faint (`#9a9ca2` / `#6c6d68`) is never used for text that carries meaning.
- No violet, no gradients, no drop shadows except on things that float (menus, dropdowns, messages, dialogs), and 3px corners.
- Fonts come from npm (`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`); remove `@fontsource-variable/inter`. No CDN, because the CSP is `default-src 'self'`.
- Desktop (`lg`, 1024px and up): 14px body text and 32px controls. Phone (below `lg`): 16px body text and 44px controls. The bottom tabs are 48px. Nothing meaningful is below 12px. Every target is at least 24px.
- Every coloured status has words next to it; colour alone never carries meaning.
- Motion is 80 to 150 ms, with a 1.4 s shimmer. Everything rests under `prefers-reduced-motion`.
- Status words, routes and behaviour are unchanged unless a task says so. Tests that check behaviour may not be weakened; tests that check class names or copy may be updated.
- Check history is shown in words only. No strips or charts anywhere.
- Use npm, never pnpm. Never touch the owner's `.env`.
- Git: one branch per phase off `develop`, with conventional commits and no Claude attribution. Each PR has a detailed description (summary, what changed, verification, risks, out of scope) with screenshots at 1440 and 390 in light and dark. Merge only when the owner says "merge".
- Run before each PR: `npm run check`, plus `npm run test:e2e` for phases 2, 6, 8 and 9.

## Review Focus

1. **Very long names, links and SKUs** (200 characters with no spaces): table cells and dropdown rows cut them off with "…", the full text is in a tooltip, and nothing scrolls sideways at 390px. Test in Task 4.2.
2. **A delayed reject or delete that fails after the 5 s:** the row comes back and an error message says so. Tests in Tasks 3.3 and 6.2.
3. **Bulk approve where some proposals were already decided or expired** (409): the rest still go through, and the failed ones are listed by product name with the server's message. Test in Task 7.1.
4. **Local storage blocked** (private mode, where `localStorage` throws): preferences fall back to defaults and nothing crashes. Test in Task 2.1.
5. **Typing fast in a server-searched dropdown,** where answers arrive out of order: only the latest search's results are shown. Test in Task 3.6.

---

## Phase 1 — Foundations (branch `feature/ui-foundations`)

### Task 1.1: D colours, fonts and base sizes

**Files:**
- Modify: `apps/web/src/theme.css` (both theme blocks and `@theme inline`), `apps/web/src/main.tsx` (font imports), `apps/web/package.json`
- Create: `apps/web/src/theme.test.ts`

**Interfaces:**
- Produces:
  - CSS settings used by every later task:
    - New: `--rule-soft`, `--hover`, `--selected`, `--faint`, `--good`, `--bad`, `--neutral`, `--font-mono`.
    - Existing names, now holding D values: `--background`, `--foreground`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--sidebar`, `--primary`, `--success`, `--danger`, `--warning`.
  - The matching Tailwind colour utilities: `bg-hover`, `bg-selected`, `text-good`, `text-bad`, `text-faint` and `font-mono`.

- [ ] **Step 1: Write the failing test** `theme.test.ts`. It reads `theme.css` as text, pulls each setting from the light block and the dark `:root.dark` block, and checks the contrast ratio (WCAG relative luminance):
  - At least 4.5 for these text pairs: `foreground`/`background`, `muted-foreground`/`background`, `muted-foreground`/`sidebar`, `good`/`background`, `bad`/`background`, `bad`/`selected`, `primary-foreground`/`primary`.
  - At least 3 for these: `input`/`background`, `ring`/`background`.
  - It also checks that the light and dark `prefers-color-scheme` blocks match `:root.dark` key for key.
- [ ] **Step 2:** Run `npx vitest run apps/web/src/theme.test.ts`. Expected: FAIL, because `good` and `selected` aren't defined yet.
- [ ] **Step 3: Implement the settings.**
  - Replace the token values with the spec's table: ground `#fbfbf8`/`#121311`, sidebar `#f4f3ee`/`#0c0d0b`, ink `#16181d`/`#ecebe4`, and so on.
  - Point the old names at D values: `--card` = ground, `--primary` = ink, `--accent` = bad, `--success` = good, `--danger` = bad.
  - Set `--radius: 3px`.
  - Install the fonts with `npm i @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono -w @stock-monitor/web` and `npm rm @fontsource-variable/inter -w @stock-monitor/web`. Import sans weights 400, 500, 600 and 700, and mono 400, 500 and 600, in `main.tsx`.
  - Set `--font-sans: "IBM Plex Sans"…` and `--font-mono: "IBM Plex Mono"…`.
  - Add `body { font-size: 16px }`, and `@media (min-width: 1024px) { body { font-size: 14px } }`.
  - Add `.font-mono { font-variant-numeric: tabular-nums }`.
  - Keep the reduced-motion rules.
- [ ] **Step 4:** Run the test again. Expected: PASS. Then run `npm run test:unit -w @stock-monitor/web`. Expected: PASS (only colours changed).
- [ ] **Step 5:** Commit `feat: direction D colours and IBM Plex fonts`.

### Task 1.2: Buttons, fields, badges and focus

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`, `input.tsx`, `badge.tsx`, `card.tsx`, `skeleton.tsx`, and `ui.test.tsx`

**Interfaces:**
- Produces:
  - `Button`: variants `default | outline | destructive | ghost | link`, sizes `default | sm | icon`, and the `loading` and `asChild` props, all as now.
    - The default size is `h-11 lg:h-8`, `sm` is `h-10 lg:h-7`, and `icon` is `size-11 lg:size-8`.
    - Classes include `cursor-pointer`, and `disabled:cursor-not-allowed`.
  - `Badge`: the same variants, now drawn as a dot plus words (the `::before` dot is `good`, `bad` or `neutral`), with no filled pill.
  - `Card`: no shadow and no rounded corners. It has a top and bottom rule.

- [ ] **Step 1: Write the failing tests** in `ui.test.tsx`:
  - `"a loading button keeps its words and shows a spinner"`: render `<Button loading>Approving…</Button>`. Expect the name "Approving…", `aria-busy="true"`, the button disabled, and a `[data-spinner]` element inside.
  - `"badge words stay visible next to the dot"`: `getByText("Needs reconnecting")`, with the `data-tone="bad"` attribute.
- [ ] **Step 2:** Run `npx vitest run apps/web/src/components/ui/ui.test.tsx`. Expected: FAIL on `data-spinner` and `data-tone`.
- [ ] **Step 3: Restyle the components** to the spec's "Components › Buttons" and "Text fields". Add `data-spinner` to the spinner and `data-tone` to the badge. The hover ring is `0 0 0 3px` of ink at 14%, the press moves down `1px`, and focus is a `2px` ring with a `2px` offset.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS. Update class-based expectations only.
- [ ] **Step 5:** Commit `feat: direction D buttons, fields and badges`.

### Task 1.3: Page header, panels and number tiles as ruled sections, and the design rules file

**Files:**
- Modify: `apps/web/src/components/PageHeader.tsx`, `Panel.tsx`, `StatTile.tsx`, and `design-system/stock-monitor/MASTER.md` (the "Owner decisions" block)
- Test: `apps/web/src/components/Field.test.tsx` (existing; stays green), plus `apps/web/src/components/StatTile.test.tsx` (create)

**Interfaces:**
- Produces:
  - `PageHeader({ title, description?, actions?, back?: { to: string; label: string } })` renders the top bar: the title, one line of description, the actions, and a rule underneath. When `back` is given, it shows "← {label}" above the title.
  - `StatRow({ children })` is a new export in `StatTile.tsx`: a grid of tiles with a rule between each.
  - `StatTile` keeps its props, plus `selected?: boolean`, which adds `aria-current="true"` and an ink underline.

- [ ] **Step 1: Write the failing tests:**
  - `StatTile` with `to` and `selected` renders a link with `aria-current="true"`.
  - `PageHeader` with `back` renders a link named "← Back to suppliers".
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** Use no card boxes:
  - `Panel` becomes a section with a rule on top, its title and description on the left, and its content on the right from `lg` up. This is the spec's "ruled row".
  - Rewrite the `MASTER.md` owner decisions: IBM Plex, the D colours, the desktop and phone sizes, the tokens living in `theme.css`, and no strips.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: ruled page header, panels and number tiles`. Push and open PR 1.

---

## Phase 2 — Frame (branch `feature/ui-frame`)

### Task 2.1: Saved preferences

**Files:**
- Create: `apps/web/src/lib/preferences.ts`, `apps/web/src/lib/preferences.test.ts`

**Interfaces:**
- Produces:
  - `type Preferences = { rows: "comfortable" | "compact"; checkStatus: boolean }`
  - `getPreference<K extends keyof Preferences>(key: K): Preferences[K]`
  - `setPreference<K>(key: K, value: Preferences[K]): void`
  - `usePreference<K>(key: K): [Preferences[K], (v: Preferences[K]) => void]`
  - Defaults: `{ rows: "comfortable", checkStatus: true }`. The storage key is `stock-monitor:prefs`.

- [ ] **Step 1: Write the failing tests:**
  - The defaults come back when nothing is stored.
  - A set value comes back from a get, and from a second hook (same-tab subscribe).
  - **Review Focus 4:** with `localStorage.getItem` and `setItem` mocked to throw, `getPreference("rows")` returns `"comfortable"` and `setPreference` doesn't throw.
  - A bad stored JSON value gives the defaults.
- [ ] **Step 2:** Run `npx vitest run apps/web/src/lib/preferences.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Wrap every read and write in try/catch, and keep an in-memory copy with a `Set` of listeners, as `lib/toast.ts` does.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat: saved display preferences`.

### Task 2.2: Sidebar with check status

**Files:**
- Modify: `apps/web/src/shell/AppShell.tsx`, `apps/web/src/App.tsx` (load `api.schedule.overview()` and refresh it every 60 s), and `apps/web/src/shell/AppShell.test.tsx`
- Create: `apps/web/src/shell/checkStatus.ts`, `apps/web/src/shell/CheckStatus.tsx`, `apps/web/src/shell/checkStatus.test.ts`

**Interfaces:**
- Consumes: `ScheduleRow` from `api.ts`, and `usePreference("checkStatus")`.
- Produces:
  - `checkStatusOf(rows: ScheduleRow[]): { on: boolean; nextAt: string | null; stopped: number }`
    - `on` means any row's interval isn't null.
    - `nextAt` is the earliest `nextCheckAt` among rows that are on.
    - `stopped` counts rows whose `status.state === "not_checked"`.
  - `<CheckStatus rows={ScheduleRow[] | null} />`. It renders nothing when `rows` is null or the preference is off.
  - `AppShell` gets a new prop, `schedule: ScheduleRow[] | null`.

- [ ] **Step 1: Write the failing tests:**
  - `checkStatusOf([])` gives `{ on: false, nextAt: null, stopped: 0 }`.
  - With two rows on and one `not_checked`: `nextAt` is the earlier time, and `stopped` is 1.
  - `CheckStatus` shows "On · next at 09:28", "1 supplier stopped", and a "See suppliers" link to `/suppliers?status=needs_reconnect`.
  - With no checks on it shows "Off".
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** Restyle the sidebar to the spec's "Desktop sidebar":
  - 224px wide, with the brand glyph.
  - Nav rows are `h-9`; the current one has a 2px ink left border and the ground colour behind it.
  - Counts are orange mono.
  - The check status sits above the account email.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: sidebar with check status`.

### Task 2.3: Phone tabs and More sheet

**Files:**
- Create: `apps/web/src/shell/BottomTabs.tsx`, `apps/web/src/shell/MoreSheet.tsx`, `apps/web/src/shell/BottomTabs.test.tsx`
- Modify: `apps/web/src/shell/AppShell.tsx`. Below `lg`, remove the slide-in menu and the menu button, and render `BottomTabs`. The skip link and focus-on-navigate stay.

**Interfaces:**
- Produces:
  - `BottomTabs({ path, proposalCount, attentionCount, onMore })`: Dashboard, Links, Proposals, Suppliers and More, each `min-h-12` with `pb-[env(safe-area-inset-bottom)]`.
  - `MoreSheet({ open, onClose, email, onSignOut, schedule })`: a radix Dialog holding `CheckStatus`, Products, Settings, the theme switch, the email and Sign out.

- [ ] **Step 1: Write the failing tests:**
  - Five tabs are links; the current one has `aria-current="page"`.
  - Proposals reads "Proposals, 12 waiting" to screen readers.
  - Pressing More opens a dialog with links named Products and Settings and a "Sign out" button.
  - Escape closes it and puts focus back on More.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** Update `AppShell.test.tsx` expectations that were tied to the old menu button, but keep its focus-on-navigate test.
- [ ] **Step 4:** Run the web unit tests, then `npm run test:e2e`. Expected: PASS, with the axe scans clean at phone size in both themes.
- [ ] **Step 5:** Commit `feat: phone tabs and More sheet`.

### Task 2.4: Browser tab count and tab icon dot

**Files:**
- Modify: `apps/web/src/useTitle.ts`, `apps/web/src/App.tsx`, `apps/web/index.html`
- Create: `apps/web/src/tabTitle.ts`, `apps/web/src/tabTitle.test.ts`, `apps/web/public/favicon.svg` (the stepped glyph), `apps/web/public/favicon-alert.svg` (the glyph with a `#c2410c` dot)

**Interfaces:**
- Produces:
  - `setPageTitle(title: string): void`
  - `setWaiting(count: number, attention: boolean): void`. Together they set `document.title` to `` `${count > 0 ? `(${count}) ` : ""}${title} · Stock Monitor` ``. The `link[rel=icon]` href becomes `/favicon-alert.svg` when `attention || count > 0`, and `/favicon.svg` otherwise.
  - `useTitle(title)` now calls `setPageTitle`.

- [ ] **Step 1: Write the failing tests:**
  - With a waiting count of 12 and the title "Proposals", the tab reads `"(12) Proposals · Stock Monitor"`.
  - A count of 0 gives `"Proposals · Stock Monitor"`, with the favicon href ending `favicon.svg`.
  - Attention with a count of 0 gives an href ending `favicon-alert.svg`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** `App.tsx` calls `setWaiting(proposalCount, attentionCount > 0)` whenever either changes.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: waiting count in the browser tab`. Push and open PR 2.

---

## Phase 3 — Feedback components (branch `feature/ui-feedback`)

### Task 3.1: Tooltip, times and copy button

**Files:**
- Create: `apps/web/src/components/ui/tooltip.tsx`, `apps/web/src/components/When.tsx`, `apps/web/src/components/CopyButton.tsx`, `apps/web/src/components/feedback.test.tsx`
- Modify: `apps/web/src/App.tsx` (wrap the app in `TooltipProvider delayDuration={400}`)

**Interfaces:**
- Produces:
  - `Tip({ label: string; children: ReactElement })`: shows on hover and on focus, and is never the only label. Icon buttons still need `aria-label`.
  - `When({ at: string })`: shows `formatWhen(at)` in mono, with a `Tip` holding the full date and time from `toLocaleString("en-GB", { dateStyle: "full", timeStyle: "medium" })`.
  - `CopyButton({ value: string; label: string })`: an icon button named `Copy {label}`. After `navigator.clipboard.writeText` it shows "Copied" for 2000 ms in an `aria-live="polite"` region; if the copy fails, it shows "Couldn't copy".

- [ ] **Step 1: Write the failing tests** (with fake timers and a mocked clipboard):
  - Focusing a `Tip` trigger shows the role `tooltip` with the label.
  - `When` puts the full date in the tooltip.
  - `CopyButton` writes `"OSB-L"`, shows "Copied", and the text is gone after 2000 ms.
  - A rejected `writeText` shows "Couldn't copy".
- [ ] **Step 2:** Run `npx vitest run apps/web/src/components/feedback.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with `radix-ui` Tooltip and the tip colours: ink background, ground text, 3px corners, and a pointer arrow.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat: tooltips, times and copy buttons`.

### Task 3.2: Messages with kinds, actions and an offline bar

**Files:**
- Modify: `apps/web/src/lib/toast.ts`, `apps/web/src/lib/toast.test.tsx`, `apps/web/src/components/ui/toaster.tsx`
- Create: `apps/web/src/components/OfflineBar.tsx` (and add its test to `feedback.test.tsx`)

**Interfaces:**
- Produces:
  - `toast(text: string, opts?: { kind?: "success" | "error"; action?: { label: string; run(): void } }): number`. It returns an id. Errors don't close on their own; everything else closes after 5000 ms. Calls to `toast(text)` elsewhere keep working.
  - `ToastItem` gains `kind` and `action`.
  - The toaster renders bottom-right from `lg` up, and full width above the bottom tabs below `lg`. Successes use `role="status"`, errors `role="alert"`.
  - `OfflineBar()` listens to `online`/`offline` and shows "You're offline. Pages show what was last loaded; changes wait until you're back."

- [ ] **Step 1: Write the failing tests:**
  - An error toast is still there after 10 s.
  - A success toast is gone after 5 s.
  - Pressing an action calls `run` and closes the toast.
  - Firing `offline` shows the bar, and `online` hides it.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** Render `OfflineBar` in `AppShell` above `main`.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat: message kinds, actions and offline bar`.

### Task 3.3: Undo through delayed actions

**Files:**
- Create: `apps/web/src/lib/deferred.ts`, `apps/web/src/lib/deferred.test.ts`
- Modify: `apps/web/src/api.ts`. `request` and `send` take an optional `keepalive?: boolean` and pass it to `fetch`. `proposals.reject(id, opts?: { keepalive?: boolean })` and the mappings `remove(id, opts?: { keepalive?: boolean })` forward it.

**Interfaces:**
- Consumes: `toast` from Task 3.2.
- Produces: `deferred({ text, commit, onUndo, onFailed }: { text: string; commit(keepalive: boolean): Promise<void>; onUndo(): void; onFailed(message: string): void }): void`.
  - It shows `toast(text, { action: { label: "Undo", … } })`, then calls `commit(false)` after `UNDO_MS = 5000`.
  - Undo cancels the call and runs `onUndo`.
  - On `pagehide`, every waiting commit runs straight away with `commit(true)`.
  - If a commit rejects, it runs `onFailed(error.message)` and shows `toast(message, { kind: "error" })`.

- [ ] **Step 1: Write the failing tests** (with fake timers):
  - `commit` isn't called before 5000 ms, and is called once at 5000 ms with `false`.
  - Undo at 3000 ms means `commit` is never called and `onUndo` is called once.
  - Firing `pagehide` at 1000 ms calls `commit(true)` straight away, and not again at 5000 ms.
  - **Review Focus 2:** when `commit` rejects with "That suggestion was already decided.", `onFailed` gets that message and an error toast appears.
- [ ] **Step 2:** Run `npx vitest run apps/web/src/lib/deferred.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with a module-level `Map<number, { timer; commit }>` and one `pagehide` listener.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat: undo for reject and delete`.

### Task 3.4: States, shimmer and pagination

**Files:**
- Modify: `apps/web/src/components/EmptyState.tsx`, `apps/web/src/components/ui/skeleton.tsx`, `apps/web/src/components/Pager.tsx`, `apps/web/src/components/Pager.test.tsx`, and `apps/web/src/components/DataTable.tsx` (the error branch uses `EmptyState kind="error"`, and the button reads "Try again")

**Interfaces:**
- Produces:
  - `EmptyState({ kind?: "empty" | "no-match" | "error" | "not-found"; title; description?; detail?: string; action? })`. Each kind has a thin lucide icon (Link, SearchX, TriangleAlert, FileX). `detail` is a small mono line, for example "timeout after 30 s · 09:14".
  - `Pager` keeps its props:
    - From `lg` up: "Showing a–b of n" in mono, Prev, the page numbers, Next, "Rows" and "Go to page".
    - Below `lg`: "‹ Page x of y ›" with `h-11` buttons.

- [ ] **Step 1: Write the failing tests** in `Pager.test.tsx`:
  - Typing 40 into "Go to page" and pressing Enter calls `onPage(40)`.
  - Typing 999 when there are 87 pages calls `onPage(87)`.
  - Typing 0 or text calls nothing.
  - Prev is disabled on page 1, and Next is disabled on the last page.
  - The current page has `aria-current="page"`.
  - In the DataTable error branch, a "Try again" button calls `onRetry`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** The shimmer uses `--shim` colours made from ground and rule, and placeholder rows match the real row height.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS. Update "Retry" to "Try again" wherever tests ask for it.
- [ ] **Step 5:** Commit `feat: states, shimmer and pagination`.

### Task 3.5: Filter chips

**Files:**
- Create: `apps/web/src/components/FilterChips.tsx` (add its test to `feedback.test.tsx`)

**Interfaces:**
- Produces: `FilterChips({ chips: { key: string; label: string; value: string; onRemove(): void }[]; onClearAll(): void })`.
  - It renders nothing when `chips` is empty.
  - Each chip reads `{label}: {value}`, with a ✕ button named `Remove {label} filter`.
  - "Clear all" only shows when there are 2 or more chips.

- [ ] **Step 1: Write the failing tests:**
  - No chips renders nothing.
  - Pressing "Remove Supplier filter" calls that chip's `onRemove`.
  - "Clear all" calls `onClearAll`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat: filter chips`.

### Task 3.6: Dropdown with search

**Files:**
- Create: `apps/web/src/components/SearchSelect.tsx`, `apps/web/src/components/SearchSelect.test.tsx`

**Interfaces:**
- Produces:
  - `type SearchOption = { id: string; label: string; detail?: string; count?: number; disabled?: boolean; note?: string }`
  - `SearchSelect({ label: string; value: string | null; valueLabel?: string; options?: SearchOption[]; search?(q: string): Promise<SearchOption[]>; allOption?: SearchOption; placeholder: string; noMatch(q: string): string; onChange(id: string | null): void })`
    - With `options`, it filters in the browser: case-insensitive, matching `label` or `detail`.
    - With `search`, it searches on the server, waiting 300 ms after typing stops.
    - ARIA: the input has `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`. The list has `role="listbox"`. Options have `role="option"`, `aria-selected` and `aria-disabled`. Matching letters are wrapped in `<mark>`.

- [ ] **Step 1: Write the failing tests:**
  - Typing "tr" shows "Brightwell Trade" and "Northline Wholesale" (matched on a detail of `northline-trade.example`), and `mark` holds "Tr".
  - ArrowDown skips an option with `disabled: true`.
  - Enter calls `onChange` with the active option's id.
  - Esc closes the list and puts focus back on the input.
  - Clicking a disabled option doesn't call `onChange`.
  - "zzz" shows `noMatch("zzz")`.
  - `allOption` is always first and calls `onChange(null)`.
  - **Review Focus 5:** `search("o")` resolves after `search("oak")`, and only the "oak" results show.
- [ ] **Step 2:** Run `npx vitest run apps/web/src/components/SearchSelect.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** on top of the radix `Popover`. Ignore late answers with a request counter in a ref.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat: dropdown with search`. Push and open PR 3.

---

## Phase 4 — Tables (branch `feature/ui-tables`)

### Task 4.1: Sort settings on the paged lists (server)

**Files:**
- Modify:
  - `packages/db/src/mapping-repository.ts` (`page`)
  - `packages/db/src/proposal-repository.ts` (`openPage`)
  - the variants repository behind `repo.listVariants`, used by `apps/api/src/routes/shopify.ts:233`
  - `apps/api/src/routes/mappings.ts` (`pageQuery`)
  - `apps/api/src/routes/proposals.ts` (`listQuery`)
  - `apps/api/src/routes/shopify.ts` (`variantsQuery`)
  - `apps/web/src/api.ts` (pass `sort` and `dir`)
- Test: `packages/db/test/mapping-repository.int.test.ts`, `packages/db/test/proposal-repository.int.test.ts`, `apps/api/test/mappings.int.test.ts`, and the proposals and shopify API int tests

**Interfaces:**
- Produces:
  - The query settings `sort` and `dir` (`"asc" | "desc"`, default `"asc"`).
    - Links: `sort ∈ {product, supplier, lastChecked}`. The default stays product, then variant.
    - Proposals (open tab): `sort ∈ {product, supplier, seen}`. The default stays as now.
    - Products: `sort ∈ {product}`.
  - Every order ends with the id as a tie-breaker, so paging stays stable.
  - An unknown `sort` or `dir` returns a 400 `invalid_input`.
  - `lastChecked` puts nulls last whichever way it sorts.

- [ ] **Step 1: Write the failing tests:**
  - Links with `sort: "supplier", dir: "desc"` come back in supplier order Z to A.
  - Pages 1 and 2 have no overlap when sorted values are equal.
  - `sort: "lastChecked"` puts never-checked links last in both directions.
  - `GET /api/mappings?page=1&pageSize=10&sort=price` returns 400.
  - With no `sort`, the order is unchanged (the existing assertions pass).
- [ ] **Step 2:** Run `npm run test:integration -- mapping-repository proposal-repository mappings proposals shopify`. Expected: FAIL.
- [ ] **Step 3: Implement** with a whitelist map from the `sort` key to Drizzle columns. Use `sql` with `nulls last` for `lastChecked`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: sort settings on paged lists`.

### Task 4.2: Restyled table with sorting, row selection, row switch and phone rows

**Files:**
- Modify: `apps/web/src/components/DataTable.tsx`, `apps/web/src/components/DataTable.test.tsx`, `apps/web/src/components/ui/table.tsx`, `apps/web/src/lib/useListParams.ts` (and its test)
- Create: `apps/web/src/components/RowsSwitch.tsx`

**Interfaces:**
- Consumes: `usePreference("rows")` (Task 2.1).
- Produces:
  - `Column<T>` gains `sortKey?: string`, `truncate?: boolean` and `title?(row: T): string`. `title` gives the full text for the tooltip when the cell is cut off.
  - `DataTable` gains:
    - `sort?: { key: string; dir: "asc" | "desc" }` and `onSort?(key: string)`, with `aria-sort` on the sorted heading and ▲ or ▼ shown.
    - `selection?: { selected: ReadonlySet<string>; onChange(next: Set<string>): void }`. This adds a tick-box column; the heading box covers the visible rows and has `aria-checked="mixed"` when only some are ticked.
    - The table carries `data-density` (from the preference) and keeps its headings on screen while scrolling.
    - Below `lg`, each row renders as a stacked block using the existing `data-label`s. Rows are always comfortable on a phone.
  - `useListParams` gains `sort: string | null` and `dir: "asc" | "desc"`, read from and written to the address.
  - `RowsSwitch()` is a two-button group reading "Rows: Comfortable | Compact", with `aria-pressed`.

- [ ] **Step 1: Write the failing tests:**
  - Clicking the "Supplier" heading calls `onSort("supplier")`, and the heading has `aria-sort="ascending"` when sorted that way.
  - Ticking the heading box with 3 rows calls `onChange` with all 3 ids. With 1 of 3 selected, the heading box is `mixed`.
  - Switching to compact gives the table `data-density="compact"`.
  - **Review Focus 1:** a cell with `truncate` and a 200-character link has the `truncate` class and a tooltip holding the full link.
  - `useListParams` turns `?sort=supplier&dir=desc` into `{ sort: "supplier", dir: "desc" }`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** Comfortable rows have 11px above and below; compact rows have 5px, and a cell's second line moves onto the same line after a "·".
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: sortable, selectable table with row height switch`. Push and open PR 4.

---

## Phase 5 — Dashboard (branch `feature/ui-dashboard`)

### Task 5.1: Recent-checks summary (server)

**Files:**
- Create: `apps/api/src/routes/recent-checks.ts`, `apps/api/src/routes/recent-checks.test.ts`
- Modify: `apps/api/src/routes/schedule.ts` (`GET /api/schedule`), `apps/web/src/api.ts` (`ScheduleRow.recent`), and `apps/api/test/schedule.int.test.ts`

**Interfaces:**
- Produces:
  - `type RecentChecks = { total: number; finished: number; failed: number; stopped: number; streak: { count: number; since: string } | null }`
  - `summarizeRuns(runs: CheckRun[]): RecentChecks`
    - It reads at most 24 ended runs, newest first.
    - `streak` is the unbroken run of `failed` or `stopped` outcomes at the newest end; `since` is the `startedAt` of the oldest run in that streak.
  - Each schedule row gains `recent`. `/api/schedule` fetches `checkRuns.recent(s.id, 25)` once, and derives both `lastRun` (the first ended run) and `recent` from it.

- [ ] **Step 1: Write the failing tests:**
  - No runs gives `{ total: 0, finished: 0, failed: 0, stopped: 0, streak: null }`.
  - 24 finished runs give `total: 24` and `streak: null`.
  - With the newest three failed (07:48, 08:08, 08:28) before finished ones, the streak is `{ count: 3, since: "<07:48 iso>" }`.
  - A running run is ignored.
  - 30 ended runs give `total: 24`.
  - Int test: `/api/schedule` rows have `recent` with `total` matching the runs in the test data.
- [ ] **Step 2:** Run `npx vitest run apps/api/src/routes/recent-checks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run it, then `npm run test:integration -- schedule`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: recent-checks summary in the schedule overview`.

### Task 5.2: The recent-checks sentence

**Files:**
- Create: `apps/web/src/components/recentChecks.ts`, `apps/web/src/components/recentChecks.test.ts`

**Interfaces:**
- Consumes: `ScheduleRow` with `recent` (Task 5.1).
- Produces: `recentChecksSentence(row: ScheduleRow, now: Date): { text: string; tone: "ok" | "bad" | "neutral" }`. It returns the exact text of the first case that matches, in this order:

| Case | Text | Tone |
|---|---|---|
| `status.state === "off"` with a `lastRun` | `No checks since ${dayWords(lastRun.endedAt)} (automatic checks off)`, where `dayWords` is "today", "yesterday" or a weekday name within 6 days, else "12 Nov" | neutral |
| `status.state === "off"` with no `lastRun` | `Automatic checks off` | neutral |
| `recent.total === 0` | `No checks yet` | neutral |
| A streak exists | `${count} failed from ${time}`, plus `, then checks stopped` when `status.state === "not_checked"`. `time` is `HH:MM` if today, else `Mon 07:48` | bad |
| All runs finished | `Last ${total} checks fine` (`Last check fine` when there is 1) | ok |
| Otherwise | `${finished} fine, ${failed + stopped} didn't finish` | neutral |

- [ ] **Step 1: Write a failing test for each case above,** with the exact strings. Use `now = 2026-11-19T09:14` UK time, and the streak of 3 from 07:48 with `not_checked`, which gives `"3 failed from 07:48, then checks stopped"`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Note for the PR:** run outcomes have no "couldn't tell", so the spec's mixed example "23 fine, 1 couldn't tell" becomes "23 fine, 1 didn't finish". Say so in the PR description.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat: recent checks in words`.

### Task 5.3: Dashboard layout

**Files:**
- Modify: `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `StatRow`, `StatTile`, `recentChecksSentence`, `When`, and `checkStatusOf`.

- [ ] **Step 1: Write the failing tests:**
  - The top bar reads "Checks on · next in … · last at …".
  - The number row has the Suppliers, Variants, In stock, Out of stock and Proposals tiles.
  - The supplier list shows each supplier's sentence, and the failure streak sentence has `data-tone="bad"`.
  - "Waiting for approval" lists at most 5 proposals, each with Approve, plus "All 12 proposals".
  - "How it works" shows only when there are no suppliers.
  - The existing loading and error behaviour for each section still passes.
- [ ] **Step 2:** Run `npx vitest run apps/web/src/pages/DashboardPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** to the spec's "Pages › Dashboard" and `pages.html` (D). The stock split bar is a decorative `aria-hidden` element next to the words.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: direction D dashboard`. Push and open PR 5.

---

## Phase 6 — Suppliers and Links (branch `feature/ui-suppliers-links`)

### Task 6.1: Suppliers page and live check progress

**Files:**
- Create: `apps/web/src/components/RunProgress.tsx` (and add its test to `feedback.test.tsx`)
- Modify: `apps/web/src/pages/SuppliersPage.tsx`, `apps/web/src/pages/SuppliersPage.test.tsx`

**Interfaces:**
- Produces:
  - `RunProgress({ run: CheckRun })` shows "Checking now" with a pulsing dot, then `` `${linksDone} of ${linksTotal} links · ${outOfStock} out so far` ``. The bar has `role="progressbar"`, `aria-valuenow={linksDone}` and `aria-valuemax={linksTotal}`.
  - When the run ends, the row gets `data-flash` for 2.4 s.

- [ ] **Step 1: Write the failing tests:**
  - `RunProgress` with 312 of 812 and 14 out reads "312 of 812 links · 14 out so far".
  - The Suppliers page:
    - The number tiles filter the list, and the chosen tile has `aria-current`.
    - The Recent checks column shows the sentence.
    - A supplier whose schedule row is running shows `RunProgress`.
    - Filter chips appear for the search and status, and "Clear all" resets both.
    - Clicking the "Supplier" heading sorts by name in the browser.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** to the spec's "Pages › Suppliers". While any row is running, refresh `api.schedule.overview()` every 3 s, and stop when none is.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: direction D suppliers page with live progress`.

### Task 6.2: Links page

**Files:**
- Modify: `apps/web/src/pages/MappingsPage.tsx`, `apps/web/src/pages/MappingsPage.test.tsx`

**Interfaces:**
- Consumes: `SearchSelect` (supplier filter, with options from `api.suppliers.list()`, `detail` = website host, and `count` = link count), `FilterChips`, `CopyButton`, `Tip`, `When`, `RowsSwitch`, `DataTable` sort, and `deferred`.

- [ ] **Step 1: Write the failing tests:**
  - Sorting by "Last checked" puts `sort=lastChecked` in the address.
  - The supplier `SearchSelect` filters to one supplier.
  - SKU and link copy buttons exist.
  - Deleting a link hides the row at once, shows "Link deleted." with Undo, and calls `api.mappings.remove` only after 5 s; Undo brings the row back.
  - **Review Focus 2:** when the delayed `remove` rejects, the row comes back and an error message shows.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** to the spec's "Pages › Links". Remove the link delete `ConfirmDialog`, and add no Recent checks column.
- [ ] **Step 4:** Run the web unit tests, then `npm run test:e2e`. Expected: PASS. Update `e2e/mappings.spec.ts` for the delete-with-Undo flow.
- [ ] **Step 5:** Commit `feat: direction D links page`. Push and open PR 6.

---

## Phase 7 — Proposals and Products (branch `feature/ui-proposals-products`)

### Task 7.1: Bulk approve and reject

**Files:**
- Create: `apps/web/src/lib/inTurn.ts`, `apps/web/src/lib/inTurn.test.ts`, `apps/web/src/components/BulkBar.tsx`
- Modify: `apps/web/src/pages/ProposalsPage.tsx`, `apps/web/src/pages/ProposalsPage.test.tsx`

**Interfaces:**
- Produces:
  - `inTurn<T>(items: T[], run: (item: T) => Promise<void>, onProgress: (done: number, total: number) => void): Promise<{ item: T; message: string }[]>`. It runs one item at a time, keeps going after a failure, and returns the failures.
  - `BulkBar({ count, onApprove, onReject, onClear, progress?: { done: number; total: number } })`. It shows "3 selected · Approve 3 · Reject 3 · Clear selection", and "Approving 2 of 3…" while working. It sits at the top of the table from `lg` up, and fixed above the tabs below `lg`.

- [ ] **Step 1: Write the failing tests:**
  - `inTurn` calls `run` in order, with progress 1/3, 2/3 and 3/3.
  - A failure on item 2 still runs item 3 and returns `[{ item: 2, message }]`.
  - On the Proposals page:
    - Ticking 3 rows shows the bar.
    - "Approve 3" opens the confirm step "Approve 3 changes? Shopify will be updated for each."; confirming calls `api.proposals.approve(id, quantity)` for each, using the quantity each row shows (`undefined` when unchanged).
    - "Reject 3" goes through `deferred` with "3 proposals rejected." and Undo.
  - **Review Focus 3:** when approve rejects on row 2 with `ApiError("This suggestion can no longer be decided.", 409)`, rows 1 and 3 are still approved, and an error message names row 2's product with that sentence.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** The supplier filter becomes `SearchSelect`, with `count` from `api.proposals.waitingBySupplier()`. Make Product, Supplier and Seen sortable (Task 4.1 settings). A single Approve or Reject per row behaves as now, except a single Reject also uses Undo.
- [ ] **Step 4:** Run the web unit tests, then `npm run test:e2e`. Expected: PASS. Update `e2e/proposals.spec.ts` for Reject with Undo.
- [ ] **Step 5:** Commit `feat: bulk approve and reject proposals`.

### Task 7.2: Products page

**Files:**
- Modify: `apps/web/src/pages/ProductsPage.tsx`, `apps/web/src/pages/ProductsPage.test.tsx`

- [ ] **Step 1: Write the failing tests:**
  - The columns are Product, Variant, SKU (with copy), Supplier, Available and Notes.
  - "0" available has `data-tone="bad"`.
  - The Product heading sorts both ways through `sort=product&dir=desc`.
  - "Only ones that need a look" sets the existing attention filter and shows a chip.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** to `screens.html` (Products).
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: direction D products page`. Push and open PR 7.

---

## Phase 8 — Settings, forms and other screens (branch `feature/ui-settings-forms`)

### Task 8.1: Settings with a side menu

**Files:**
- Create: `apps/web/src/pages/settings/SettingsLayout.tsx`, `apps/web/src/pages/settings/AppearancePage.tsx`, `apps/web/src/pages/settings/AccountPage.tsx`, `apps/web/src/pages/settings/SuggestionsPage.tsx`, `apps/web/src/lib/theme.ts`
- Modify:
  - `apps/web/src/App.tsx` (routes)
  - `apps/web/src/router.test.tsx`
  - `apps/web/src/shell/Breadcrumbs.tsx` (`crumbsForPath`)
  - `apps/web/src/shell/ThemeToggle.tsx` (use `lib/theme.ts`)
  - `apps/web/src/pages/SettingsShopifyPage.tsx` (Connection, Location and Sync only; `ProposalSettingsCard` moves to `SuggestionsPage`)

**Interfaces:**
- Produces:
  - Routes: `/settings` and `/settings/shopify` show Shopify; also `/settings/suggestions`, `/settings/appearance` and `/settings/account`.
  - `getTheme(): "system" | "light" | "dark"` and `setTheme(t)` in `lib/theme.ts`, with the same storage key `ThemeToggle` uses now.
  - `SettingsLayout({ current, children })`: the side menu from `lg` up, and a list you tap into below `lg`.

- [ ] **Step 1: Write the failing tests:**
  - Each settings address renders its page, and the menu item has `aria-current="page"`.
  - Appearance: choosing Dark calls `setTheme("dark")`, and the `html` element gets the `dark` class; choosing Compact sets the `rows` preference; turning off "Show check status in the sidebar" hides `CheckStatus`.
  - Account shows the owner's email and Sign out.
  - The existing `SettingsShopifyPage` tests pass.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** to `screens.html` (Settings and Settings · Appearance), with sections as `Panel` ruled rows.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: settings with a side menu and appearance page`.

### Task 8.2: Forms and work screens

**Files:**
- Create: `apps/web/src/components/ui/switch.tsx` (radix Switch)
- Modify:
  - `apps/web/src/pages/SupplierFormPage.tsx` (and its test)
  - `apps/web/src/pages/MappingFormPage.tsx` (and its test)
  - `apps/web/src/pages/ConnectSupplierPage.tsx`
  - `apps/web/src/pages/ImportMappingsPage.tsx` (and its test)
  - `apps/web/src/pages/StockRulesPage.tsx` (and its test)
  - `apps/web/src/components/AutoLoginCard.tsx`, `SchedulePanel.tsx`

**Interfaces:**
- Consumes: `Panel` ruled rows, `PageHeader back`, `SearchSelect` (the link form variant picker uses `search: (q) => api.mappings.unmapped(q)` mapped to options, with linked variants `disabled` and `note: "linked"`; the supplier picker uses `options`).
- Produces: `Switch({ checked, onCheckedChange, label, hint? })`. It is used only where a field is a plain on/off: automatic login, keep login alive, hide automation, and a rule's on/off. The saved values are unchanged.

- [ ] **Step 1: Write the failing tests:**
  - Supplier form: the "Automatic login" switch has `role="switch"`, and toggling it saves the same field value the old control did.
  - Link form: typing "oak" lists matching variants, and a linked one is disabled.
  - Each form has a save bar with its main button.
  - The existing save and validation tests pass.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** to `screens.html` (Add supplier, Add link, Connect supplier, Stock rules, Import links). Connect supplier keeps the `LiveWindow` component and its behaviour; only the frame and step list change.
- [ ] **Step 4:** Run the web unit tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: direction D forms and work screens`.

### Task 8.3: Sign in and page not found

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx` (and its test), `apps/web/src/pages/NotFoundPage.tsx`

- [ ] **Step 1: Write the failing tests:**
  - The sign-in page shows "Know what your suppliers have, before your customers order." and the "Check", "Propose" and "Approve" lines.
  - It shows no numbers and makes no API calls before sign-in: the mock `api` gets no calls other than `auth`.
  - Not found shows "Page not found" with "Go to Dashboard".
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** to `screens.html` (Sign in, Not found). The split goes away below `lg`.
- [ ] **Step 4:** Run the web unit tests, then `npm run test:e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: direction D sign in and not found`. Push and open PR 8.

---

## Phase 9 — Final pass (branch `feature/ui-final-pass`)

### Task 9.1: Accessibility sweep, screenshots and docs

**Files:**
- Create: `e2e/redesign.spec.ts`
- Modify: `docs/status.md`

- [ ] **Step 1: Write `e2e/redesign.spec.ts`.**
  - For each of `/`, `/suppliers`, `/mappings`, `/products`, `/proposals`, `/settings/appearance`, `/mappings/new` and `/login`: visit it at 390×844 and 1440×900, in light and dark (set through `localStorage` before load), and run the same `AxeBuilder` tags as `e2e/suppliers.spec.ts:39`.
  - Expect no violations, and `document.documentElement.scrollWidth <= innerWidth` (no sideways scroll).
  - Save screenshots to `test-results/redesign/<page>-<width>-<theme>.png`.
- [ ] **Step 2:** Run `npm run test:e2e -- redesign`. Expected: PASS. Fix any violation in the component that causes it, never by turning off a rule.
- [ ] **Step 3:** Compare the screenshots by eye with the three mockups. Fix layout drift that changes meaning or breaks the anti-goals.
- [ ] **Step 4:** Update `docs/status.md` with what shipped in phases 1 to 9 and the two spec changes made while building ("didn't finish", and no Recent checks column on Links).
- [ ] **Step 5:** Commit `test: accessibility sweep for the redesign` and `docs: status after the redesign`. Push and open PR 9 with the screenshots attached.
