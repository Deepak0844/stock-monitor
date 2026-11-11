# UI redesign: design

Date: 2026-11-11. Status: draft, waiting for the owner's approval.

## Intent and why

The pilot run works, so the owner wants every screen of the web app (`apps/web`) to look and behave like a professional
product. The owner's list: a professional dashboard and pages, proper lists with pagination, modals where needed,
consistent alignment, British English, friendly UX, pages that link to each other, loading skeletons and button
loaders, and a notification area instead of only inline alerts.

## Goals

1. One consistent look across Dashboard, Suppliers, Links, Products, Proposals, Settings, Connect, Login and Not found.
2. Every list has server-side pagination, search and filters, with page and page size in the URL.
3. A modal for every destructive or irreversible action (delete supplier, delete link, delete rule, disconnect).
4. Shimmer skeletons while data loads. A spinner inside a button while its action runs, and the button is disabled.
5. A notification bell with an unread count and a panel, backed by the existing `/api/notifications` routes.
6. Pages connect: breadcrumbs, dashboard tiles that open the matching filtered list, and "next step" links on empty states.
7. British English in all visible text (colour, authorise, cancelled, organisation).
8. Light and dark themes. Keyboard and screen-reader accessible (contrast of at least 4.5:1, visible focus).

## Non-goals and anti-goals

- No new product features. Behaviour of checks, schedules, proposals and mappings does not change.
- No new visual identity beyond the store colours. We refine the current layout, we do not reinvent it.
- Not a failure if a page looks plainer than the preview, but it is a failure if any existing journey breaks.
- No toast-only errors. Problems the owner must act on stay visible on the page and also go to the bell.

## Constraints

- The repo is public: no supplier names or domains in code, tests, docs or fixtures. Preview names are invented.
- Use npm, not pnpm. Never touch the owner's `.env` (see memory notes).
- The app serves a strict Content-Security-Policy (`apps/api/src/app.ts`). No inline style attributes in markup.
- Existing tests (`*.test.tsx`) use roles and text. They must keep passing or be updated with the same intent.
- Git workflow: feature branches off `develop`, no Claude attribution in commits, detailed PRs.

## Approaches considered

1. **Keep the hand-written CSS and polish it.** Lowest risk and no new dependencies. But every new component
   (modal, dropdown, table, pager, toast) is hand-built and hand-tested for accessibility.
2. **Tailwind v4 only.** Faster styling, still hand-built behaviour components.
3. **Tailwind v4 plus shadcn/ui (Radix).** Ready, accessible dialog, dropdown, table, skeleton, pagination and toast
   components that live in our repo. Needs a small CSP change because Radix adds `<style>` tags at runtime.

**Picked: 3**, by the owner (asked for it directly), because the whole app is being rewritten anyway and the
accessible components are the bulk of the work. Fallback if the CSP change is refused: native `<dialog>` for modals.

## Decisions made with the owner

- **Layout:** the refined version of the current layout: sidebar navigation, top bar with breadcrumbs and bell,
  page header, summary tiles, table panel. The preview (suppliers page, variant A) is the reference.
- **Colour and style:** follow the owner's store. Dark brown (about `#5B3420`) for the sidebar and top banner,
  black for primary buttons and selected segments, orange accent (about `#E8873A`, active marker, badges, arrows,
  never body text on white), white surfaces on a very light page. Inter, about 12px rounded corners, outlined
  secondary buttons, segmented selectors like the store's pack-size control.
  Status colours stay separate green, amber and red. Exact values come from the store at build time.
  Dark mode uses a deep brown-black.
- **Stack:** Tailwind v4 through the Vite plugin, shadcn/ui components copied into `apps/web/src/components/ui/`.
  The hand-rolled router stays.
- **CSP:** allow `style-src 'self' 'unsafe-inline'`. Scripts stay `'self'` only. Verify the modal, dropdown and
  toast in a real browser before rewriting pages.
- **Pagination:** on the server, for Suppliers, Links (mappings) and Proposals. Products already has it.
  Query `page`, `pageSize`, `search` and the existing filters. The response is `{ items, total, page, pageSize }`,
  the same shape as `VariantPage`. The UI reads and writes these in the URL so pages can be bookmarked.
- **Notifications:** the bell shows the open notifications from `/api/notifications` with an unread count and
  "mark as read". The existing read route is reused. "Mark all as read" and a full notifications page are extra and
  need a small API addition (decide in the plan).

## Left to the builder

- Exact shadcn component set and the order of migration.
- Page sizes (preview uses 6, 12 and 24; default 10 or 25 is fine).
- Whether Links and Proposals filters stay as they are or become dropdowns in the toolbar.
- Skeleton shapes per page.
- How to write the Tailwind theme tokens so both themes share one set of names.

## Delivery slices

1. Branch, Tailwind v4, shadcn init, theme tokens, CSP change, a browser check of modal, dropdown and toast.
2. Shared parts: app shell, top bar, bell, page header, data table, pager, empty state, skeleton, confirm modal,
   loading button, toast.
3. Server pagination for suppliers, mappings and proposals, with tests.
4. Pages in this order: Suppliers (reference), Dashboard, Links, Proposals, Products, Settings, Connect, Login, Not found.
5. British English sweep, responsive pass, accessibility pass, e2e run.
