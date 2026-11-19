# UI redesign: direction D ("Ledger")

Mockups:

- [pages.html](2026-11-19-ui-redesign/pages.html): Dashboard, Suppliers and Links in four directions. Use the switches and pick direction D.
- [components.html](2026-11-19-ui-redesign/components.html): D's components, states and phone screens.
- [screens.html](2026-11-19-ui-redesign/screens.html): Products, Proposals, Settings with its side menu, Appearance, the forms, Connect, Stock rules, Import, Sign in and Not found. It also has the row switch and the sidebar check status. Open them in a browser. They are references for the look, not code to copy.

## Intent

The owner says the web app "looks like AI slop". The causes they confirmed:

- every block is the same white rounded card with a soft shadow, so nothing stands out;
- Inter, the default font of AI-made apps;
- dashboard tiles made of an icon in a grey square over a big number;
- the brown sidebar, orange pills and beige ground.

They want it to look designed on purpose: a serious tool for checking stock every day, in light and dark, and good on a phone, which they use often. The whole app is in scope.

The owner is one non-technical operator. They check stock, approve or reject proposals, and reconnect suppliers that logged out.

## Goals

1. Restyle the whole web app (`apps/web`) to direction D, "Ledger": paper and ink, thin rules instead of boxes, numbers that line up, words for check history.
2. The six component items the owner asked for: loading shimmer, pagination, dropdown with search (only where needed), empty, error and other states, button loader with a hand pointer on everything clickable, and tooltips.
3. The extras the owner picked: bulk approve, filter chips, messages with Undo, copy buttons, sortable columns, a count in the browser tab, and live check progress.
4. A designed phone layout, not just one that doesn't break.
5. Light and dark themes for everything. The app follows the system setting, and the existing manual toggle stays.

## Non-goals

- No change to what pages do, their routes, their data or their status words, except where this document says so.
- **No check strips or bar charts of check history, anywhere.** The owner looked at them and decided they were unclear. Check history is shown in words only.
- No quick jump (Ctrl/Cmd+K). It was offered and not picked.
- Of the 12 "more ideas" in the components mockup, the owner picked three: the compact or comfortable row switch, check status in the sidebar, and Settings with a side menu. They are in scope (see Design). The other nine are not in this project: details panel, "since your last visit", saved filters, supplier icons, before and after on proposals, keyboard keys for proposals, notifications redesign, CSV download, and the getting-started checklist.
- No marketing or landing page.

## Anti-goals (a failure even if it works)

- The template look coming back: the same rounded card with a drop shadow around everything, icon tiles, gradients, violet, emoji or cartoon illustrations.
- Colour as the only signal. Every coloured dot or text has words next to it.
- Information the owner must know hidden inside a tooltip.
- Accessibility checks getting worse in either theme, at either size.
- A redesign that changes behaviour: buttons doing something different, or tests weakened to get it through.

## Constraints

- **Stack:** React 19, Vite, Tailwind v4, `radix-ui`, `lucide-react` and `class-variance-authority`, in npm workspaces (never pnpm). Build on what's there.
- **Self-hosted fonts.** The Content-Security-Policy is `default-src 'self'`, so fonts come from npm (`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`), never from a CDN. Inter is removed.
- **Accessibility:**
  - Text contrast is at least 4.5:1 and control borders at least 3:1, in both themes.
  - Everything works from the keyboard, focus is always visible, and motion stops under reduced motion.
  - The Playwright and axe scans in `e2e/` (light and dark, phone and desktop) stay green.
- **Tests:** existing unit tests (vitest, Testing Library) and e2e tests keep passing. Tests that check class names may be updated. Tests that check behaviour may not be weakened.
- **Design rules file:** the owner decisions in `design-system/stock-monitor/MASTER.md` are rewritten for D (font, colours, density) in the first PR. It also wrongly points at `styles.css`; the live tokens are in `apps/web/src/theme.css`.
- **Git** ([[git-workflow-preferences]]): one feature branch off `develop` per phase, a detailed PR for each, no Claude attribution, and merge only when the owner says "merge".
- **Owner's `.env`:** never touched.

## Approaches

### Look (decided with the owner)

Four directions were mocked up in light and dark: A Ledger (dense work tool), B Workshop (warm serif back office), C Control room (dark, live signals), and D, which is A plus C's check information.

- **The owner picked D.** It is dense and calm, and suits checking stock every day.
- **Check strips were then removed.** D first carried C's strip of 24 check bars. The owner asked how anyone would read it and chose a sentence instead ("Last 24 checks fine", "3 failed from 07:48, then checks stopped").

### Build (my call)

1. **Restyle in place, starting from the colour and font settings (picked).** Change the theme settings and the shared components first (`components/ui/*`, `PageHeader`, `Panel`, `StatTile`, `DataTable`, `Pager`, `EmptyState`, `Notice`, `shell/*`), so every page changes at once. Then do one layout pass per page. It fits the existing code and splits into small, safe PRs.
2. **A new component set next to the old one, moving pages one at a time.** Not picked: two looks would live side by side for weeks, with more code to keep up.
3. **Rewrite the pages from scratch.** Not picked: high risk to behaviour and tests, for no gain in look.

## Design

### Colours and fonts

All colours live as theme settings in `apps/web/src/theme.css`. Light and dark values are taken from the mockups:

| Role | Light | Dark |
|---|---|---|
| Ground | `#fbfbf8` | `#121311` |
| Sidebar | `#f4f3ee` | `#0c0d0b` |
| Ink (text, primary button) | `#16181d` | `#ecebe4` |
| Secondary text | `#3c3f46` | `#c4c3bc` |
| Muted text | `#6b6e76` | `#9c9d97` |
| Faint (de-emphasised numbers) | `#9a9ca2` | `#6c6d68` |
| Rule | `#e2e1da` | `#2a2b27` |
| Row rule | `#ebeae4` | `#1e1f1c` |
| Input border | `#8f9097` | `#64655f` |
| Good (in stock, connected) | `#15803d` | `#4ade80` |
| Needs you (out of stock, failed, logged out) | `#c2410c` | `#fb923c` |
| Neutral (paused, can't tell) | `#b9b8b0` | `#4a4b46` |
| Row hover | `#f0efe9` | `#1c1d1a` |
| Selected row | `#fdf1e7` | `#2a1d12` |
| Focus ring | `#1d4ed8` | `#93c5fd` |

- **Colour meaning:** green means fine, orange-red means needs you, grey means neutral. There's no other accent colour and no violet. Every pair must pass the contrast rules above; the builder checks each one and adjusts the value, not the rule.
- **Faint is decoration only (my call).** Faint (`#9a9ca2` / `#6c6d68`) is below 4.5:1, so it is used only on rules, disabled things and pure decoration. Any text that carries meaning uses muted or darker, including the "/4" in "3/4", struck-out old values and page-number gaps. "Needs you" on a selected row (`#c2410c` on `#fdf1e7`, about 5:1) passes.
- **Fonts:** IBM Plex Sans for the interface. IBM Plex Mono, with lined-up digits, for numbers, times, SKUs and links.
- **Shape:** 3px corners. No shadows, except on things that float (menus, dropdowns, messages, dialogs). Thin rules separate sections, and a rule in ink sits under table headings.
- **Motion:** 80 to 150 ms on hover and press, and a 1.4 s shimmer. Everything rests under reduced motion.
- **Text size and control height:** 14px text and 32px controls on desktop; 16px text and 44px controls on phone (see Owner decisions).

### Frame (sidebar, top bar, phone tabs)

- **Desktop sidebar** (from the current `lg` width up):
  - 220px wide, in the sidebar colour.
  - Brand mark (the stepped glyph) and "Stock Monitor".
  - Text links with counts in orange mono: Dashboard shows its "needs you" count, Proposals its waiting count.
  - The current page gets an ink bar on its left and the ground colour behind it.
  - The account email sits at the bottom.
- **Check status in the sidebar (owner pick):**
  - A small "Checks" box sits above the account email.
  - It shows "On · next at 09:28" (or "Off"), and "N supplier stopped" in the "needs you" colour when any supplier's automatic checks have stopped, with a "See suppliers" link to the Suppliers page filtered to those.
  - It reads the schedule overview the app already loads.
  - It can be hidden under Settings › Appearance.
  - On a phone it appears at the top of the More sheet.
- **Top bar on each page:** the page title and a one-line description on the left, the page's actions on the right, and a rule underneath. The notification bell and theme toggle stay, restyled.
- **Phone (below `lg`):**
  - The slide-in menu is replaced by five tabs at the bottom: Dashboard, Links, Proposals (with count), Suppliers, More.
  - **More** opens a sheet with Products, Settings, the theme toggle, the account and Sign out.
  - Each tab is at least 48px tall and leaves room for the phone's home bar.
  - The top bar shows the page title and at most one main action.
- **Browser tab:**
  - The title becomes "(12) Proposals · Stock Monitor" while proposals are waiting, and has no count otherwise.
  - The tab icon switches to a version with an orange dot while anything needs the owner.
  - "Needs the owner" uses the same sources as the counts the sidebar already shows: `proposalCount` and `attentionCount`, which is the notifications list (`notifications.items.length` in `App.tsx`). No new endpoint is needed.
  - The icon can be two static SVG files in `public/`. The CSP already allows `img-src 'self' data:`.

### Components

- **Buttons:**
  - Types: solid ink (the main action), outlined (everything else), danger, text-only, and icon-only. An icon-only button always has a label for screen readers and a tooltip.
  - States: hover ring, pressed (moves down 1px), a 2px focus ring, and disabled.
  - Loading: a spinner plus the action word ("Approving…"), at the same width.
  - Every clickable element shows the hand pointer; disabled ones show "not allowed".
- **Text fields and plain dropdowns:** the input border colour, and a focus ring when active.
- **Dropdown with search**, only for the supplier pickers (Links filter, Proposals filter, supplier on the link form) and the variant picker on the link form:
  - Behaves as a standard accessible dropdown with search (the ARIA combobox and list pattern).
  - Keys: arrows move, Enter picks, Esc closes.
  - The matching letters are marked.
  - Search matches the supplier name or website, or the variant name or SKU.
  - Variants that are already linked are shown but can't be picked.
  - With no match it says "No supplier matches '…'".
  - Each supplier shows its link count.
  - Suppliers are filtered in the browser. Variants are searched on the server with the existing variant search, because there can be thousands.
  - All other dropdowns stay plain.
- **Tooltips** (radix Tooltip):
  - Appear after a short pause on hover or keyboard focus, and on long-press on a phone.
  - Used on icon buttons, times (the full date and time behind "09:14"), cut-off links, and status words that have an explanation.
  - Never the only place something is said.
- **Loading shimmer:**
  - Headings and labels stay real; only the values shimmer.
  - Placeholder rows have the same height and columns as real rows, so nothing jumps when data arrives.
- **Pagination:**
  - "Showing 26–50 of 2,169" in mono.
  - The first, last and nearby page numbers, with gaps between.
  - Prev and Next, greyed out at the ends.
  - Rows per page, and a "Go to page" box.
  - On a phone: "‹ Page 2 of 87 ›" with 44px buttons.
- **States**, each in plain words with the next step:
  - Nothing yet: what will appear here, plus the page's own buttons.
  - No matches: the active filters and "Clear filters".
  - Couldn't load: the cause in plain words, "Nothing was changed", Try again, and a small detail line such as "timeout after 30 s · 09:14".
  - Page not found: "Go to Dashboard" and Back.
  - Offline: a bar across the top, from the browser's offline signal or a failed request, with Try again.
  - One thin line icon each, no illustrations.
- **Filter chips:**
  - Every active filter, including the search text, appears as a small tag above the table.
  - ✕ removes one; "Clear all" removes them all.
  - The counts update as filters change.
- **Messages (toasts):**
  - Ink-coloured. Bottom-right on desktop; at the bottom on a phone, above the tabs. Read out to screen readers.
  - Success messages close after about 5 s. Error messages stay until closed.
  - **Undo** applies to Reject (proposals, one or many) and to deleting a link. The row is hidden at once, the request waits 5 s in the browser, and Undo brings the row back and cancels the request. Deleting a link with Undo replaces its current confirm dialog.
  - **Deleting a supplier keeps its confirm dialog and gets no Undo (my call).** It removes the supplier's links and saved login, which is too big to hide behind a 5-second message.
  - If the owner leaves the page within the 5 s, the waiting request is sent straight away (`fetch` with `keepalive`), on a best-effort basis. If a delayed request fails, the row comes back and an error message says so. The server is not changed: there is no soft delete.
- **Copy buttons:**
  - A small icon next to SKUs, supplier links and product names.
  - After a click it shows "Copied" for 2 s, and screen readers hear it.
- **Tables** (`DataTable`):
  - Thin row rules, an ink rule under the headings, and a tint on the row under the pointer.
  - Headings stay on screen while scrolling.
  - **Sorting:** a heading that can sort shows ▲ or ▼ when it is active and tells screen readers the sort order.
  - **Selecting rows (optional per table):** a tick-box column, and a heading box that ticks the whole page or shows "some" when only part of it is ticked.
  - **On a phone:** each row becomes a stacked block with the main field bold, its status line, a supporting line, and a › when the row opens something.
- **Compact or comfortable rows (owner pick):**
  - Two row heights for tables. Comfortable is the default (about 11px above and below each row's text). Compact is about 5px, and moves the second line of a cell onto the same line after a "·".
  - The switch ("Rows: Comfortable | Compact") sits above each long table (Links, Products, Proposals, Suppliers), and the same choice is under Settings › Appearance.
  - The choice is saved on the device (local storage) and applies to every table.
  - On a phone, rows are always comfortable.

### Words for recent checks (suppliers)

Each supplier's recent checks are described in one sentence, built from its most recent check runs:

| Situation | Sentence |
|---|---|
| All recent runs finished | "Last 24 checks fine" (the number is how many there are, up to 24) |
| Some couldn't tell | "23 fine, 1 couldn't tell" |
| A failure streak is going on | "3 failed from 07:48, then checks stopped" |
| Paused | "No checks since Monday (paused)" |
| Never checked | "No checks yet" |

A failure streak is written in the "needs you" colour, in bold. A healthy sentence is in secondary text. This sentence appears on the Suppliers page and in the Dashboard's supplier list.

### Live check progress

While a supplier's check runs, its row:

- shows "Checking now" with a softly pulsing dot;
- shows "312 of 812 links · 14 out so far" with a thin progress line;
- updates on its own, using the polling the app already does;
- takes its numbers from what each check run already records (`linksTotal`, `linksDone`, `outOfStock`), and reads the next and last check times from the schedule overview (`nextCheckAt`, `lastRun`), so the server needs no change;
- flashes softly once when the check finishes, then shows its usual sentence.

There is no Stop button, because the app has no way to stop a run.

### Bulk approve and reject (Proposals)

- **Selecting:** tick rows, or the heading box for the whole page.
- **Bar:** a bar appears saying "3 selected · Approve 3 · Reject 3 · Clear selection". On a phone it sits at the bottom, above the tabs.
- **Confirm first (my call):** "Approve 3" opens one short confirm step, "Approve 3 changes? Shopify will be updated for each." A single Approve stays one click, as now.
- **Approve:** each proposal is approved one after another with the existing approve call. Each uses the quantity its row shows: the owner's edited number if they changed it, otherwise the suggestion, exactly as a single Approve does. Approving only records the decision and queues the Shopify write for the worker, the same as today. The bar shows "Approving 2 of 3…", and any that fail are listed in words.
- **Reject:** goes through the 5-second Undo.

### Pages

- **Dashboard:**
  - **Top bar:** "Checks on · next in 14 min · last at 09:14".
  - **Number row:** Suppliers (3/4), Variants (312 not linked), In stock, Out of stock (with a thin bar of how stock is split between in, out and can't tell), and Proposals.
  - **Left column:**
    - "Suppliers · recent checks": name, sentence, last check time and status.
    - "Waiting for approval": the newest five, each with Approve, plus "All N proposals".
  - **Right column:**
    - "Needs you": each item with its button.
    - "Links": how many variants are linked, a progress line, and "Link variants".
  - **"How it works":** the current four steps show only while no supplier exists yet (my call).
- **Suppliers:**
  - The top bar has "+ Add supplier".
  - The number row doubles as the status filter (All, Connected, Needs reconnecting, Paused); the chosen one is underlined.
  - Search and the status dropdown, then the filter chips.
  - Columns:
    - Supplier: name, with the website underneath.
    - Status: a dot and the word, with "Checked 09:14" underneath.
    - Recent checks: the sentence.
    - Automatic checks: the schedule, with the last run underneath.
    - Actions: the main action, plus a ⋯ menu.
- **Links:**
  - The top bar has "Import from Shopify export" and "+ Add link".
  - Number row: Variants, Linked, Not linked, Need a look.
  - Filters: search, supplier (dropdown with search), status, stock, and "Check all links". The filter chips sit underneath.
  - Columns:
    - Product: name, with variant and SKU underneath and a copy button.
    - Supplier page: the supplier, with the shortened link underneath, a tooltip for the full link, and a copy button.
    - Status: a dot, with its explanation underneath.
    - Stock: a dot, with when it was seen and the proposal link underneath.
    - Last checked: mono, with "Not checked recently" when it applies.
    - Actions.
  - **No "Recent checks" column on Links (my call; this differs from the mockup).** The app has no per-link check history. The link status and its explanation already say what's wrong ("The page changed…").
- **Proposals:** the current layout plus bulk approve, sortable columns (Product, Supplier, Seen) and the supplier dropdown with search.
- **Settings with a side menu (owner pick):**
  - The left menu has Shopify, Stock suggestions, Appearance and Account.
  - **Shopify:** Connection, Inventory location and Sync.
  - **Stock suggestions:** hours a suggestion stays open, and the quantity for back-in-stock suggestions.
  - **Appearance:**
    - Theme: Follow my device, Light or Dark, each with a small swatch.
    - Rows: Comfortable or Compact, each with a small preview.
    - Sidebar check status: on or off.
  - **Account:** the owner's email and sign out. Nothing new on the server.
  - Each section is a ruled row: a title and description on the left, fields on the right.
  - Each menu item has its own address (`/settings/shopify`, `/settings/suggestions`, `/settings/appearance`, `/settings/account`); `/settings` opens Shopify.
  - On a phone the menu becomes a list you tap into.
- **Forms (add or edit supplier, add link):**
  - Ruled sections with a title and description on the left and fields on the right.
  - Switches for on/off settings.
  - "Login page fields (advanced)" stays folded away.
  - A save bar at the bottom.
  - The link form gets the dropdowns with search.
- **Products, Connect supplier, Import, Stock rules, Sign in and Not found:** the new frame and components, laid out as in `screens.html`. Sign in becomes a split page: the brand line and three short lines on what the app does on the left, the form on the right. It shows no live numbers, because the page is visible before anyone signs in.
- **Phone layouts:** Dashboard, Suppliers and Proposals as in the mockup. The other list pages use the same stacked rows, and forms are one column with full-width buttons.

### Small server additions

1. **Recent-checks summary per supplier.** Each supplier's recent-checks sentence needs a summary of its last 24 runs:
   - how many finished, failed and stopped;
   - the start time of the current failure streak, if there is one;
   - whether automatic checks are now stopped.

   It is added to the existing schedule overview response, so the Suppliers page needs no extra request. It is read from the existing check runs table, and needs no new table.
2. **Sorting.** Optional `sort` and `dir` settings on the paged lists:
   - Links: product, supplier, last checked.
   - Products: name.
   - Proposals: product, supplier, seen.

   Only listed columns are accepted, and the default order is unchanged. The Suppliers list is small and is sorted in the browser.

Nothing else on the server changes. Bulk approve uses the existing per-proposal calls, and Undo is handled in the browser.

### Order of work (one PR each, into `develop`)

1. **Foundations:** the new colours and fonts in light and dark, Inter removed, the buttons, fields, badges and focus restyled, and `MASTER.md` updated.
2. **Frame:** sidebar, top bar, phone tabs and More sheet, the browser-tab count and icon dot, and the restyled bell and theme toggle.
3. **Feedback components:** loading shimmer, the states, messages with Undo, tooltips, copy buttons, pagination, filter chips, and the dropdown with search.
4. **Tables:** the restyled `DataTable` with headings that stay on screen, sorting and selecting rows, the phone stacked rows, and the server's sort settings.
5. **Dashboard:** the new layout, plus the server's recent-checks summary.
6. **Suppliers and Links:** the page layouts and live check progress.
7. **Proposals and Products:** bulk approve and reject, and sorting.
8. **Everything else:** Settings, forms, sign-in, connect, import, stock rules and page not found.
9. **Final pass:** accessibility scans in light and dark on phone and desktop, screenshots compared with the mockups at 1440, 1024, 768 and 390, `docs/status.md`, and the owner's review.

Each PR keeps the app working and every check green.

### Verification

- **Unit tests** for new behaviour:
  - the dropdown with search: keys, matching, and items that can't be picked;
  - Undo: timing, cancel, and sending at once when leaving;
  - pagination edges, filter chips, sort order announced to screen readers, and tri-state row selection;
  - the bulk approve progress and failure list;
  - the recent-checks sentence for each situation;
  - the browser-tab title.
- **API tests** for the recent-checks summary and the sort settings.
- **e2e:** the existing axe scans stay green in light and dark on phone and desktop.
- **Screenshots:** compared with the mockups at the four widths, in both themes.
- **What counts as done (my call):** the automatic checks must pass (unit, API, e2e and axe). The mockups guide the look and the layout but are not a pixel-perfect target. Each PR includes screenshots at 1440 and 390 in light and dark, so the owner can sign it off by eye.

### Left to the builder

- Component APIs and file layout, and the Tailwind class structure.
- The exact breakpoint, as long as it keeps the existing `lg` split.
- How the dotted tab icon is made.
- Polling and debounce timings (reuse the existing ones).
- How headings stay on screen.
- Test file layout.

## Owner decisions

1. **Text size and control height (decided 2026-11-19).**
   - **Desktop** (from `lg` up): 14px body text and 32px controls. Smaller labels go down to 12px; nothing that carries meaning is below 12px.
   - **Phone** (below `lg`): 16px body text and 44px controls. The bottom tabs are 48px.

   Every target is at least 24px, with space between targets (WCAG 2.2 target size). `MASTER.md` is updated to say so.
