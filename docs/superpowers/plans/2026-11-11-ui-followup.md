# UI follow-up Implementation Plan

> **For agentic workers:** execute inline (native), tests first. Spec: the owner's approved preview of the stock rules page (two-column saved pages with Picture / Page text tabs, versions with contents, compare and "Edit as new version", toasts) and `docs/superpowers/specs/2026-11-11-ui-redesign-design.md`.

**Goal:** Fix three problems found in use: the saved-pages view, messages that push content down, and no way to delete rule versions.

**Global constraints:** British English. No inline styles. Errors stay inline (never toast-only). Versions are never edited in place. The version that is turned on cannot be deleted. Repo is public: no real supplier names.

## Task 1: Delete a rule version (API)
- Files: `packages/db/src/recipe-repository.ts`, `apps/api/src/routes/recipes.ts`, tests `packages/db/test/recipe-repository.int.test.ts` (or the existing recipe test), `apps/api/test/recipes.int.test.ts`.
- Produces: `repo.remove(id): Promise<"deleted" | "not_found" | "active">`; `DELETE /api/recipes/:id` returns `{ ok: true }`, 404 `recipe_not_found`, 409 `recipe_active` ("Turn another version on first."), writes audit `recipe.deleted`.
- Tests: deletes an inactive version; refuses the active one; unknown or malformed id is 404; needs a session; next saved version number is still max+1 of what remains is NOT required (numbers may repeat only if the highest is deleted: keep `max(version)+1` of existing rows, documented).

## Task 2: Toasts
- Files: `apps/web/src/lib/toast.ts` (tiny store: `toast(text)`, `subscribe`), `apps/web/src/components/ui/toaster.tsx`, mount in `App.tsx`; delete `ui/sonner.tsx`; replace success `Notice`s with `toast()` in Suppliers, Links, Proposals, Settings cards, permission/region/schedule panels, Stock rules.
- Toaster: polite live region, bottom right, each toast auto-dismisses after 4 s and has a Dismiss button; errors never use it.

## Task 3: Progress in the row
- Suppliers: while a connection check runs, the Status cell shows a pulsing "Checking…" badge. Links: same for Check now and Check stock. Cleared when the answer arrives or the refresh gives up.

## Task 4: Stock rules page
- API client: `recipes.remove(id)`.
- Saved pages: fixed-height two columns (list | detail), tabs Picture / Page text, Open full size, search and copy in Page text, phone shows list then detail.
- Versions: each opens to show its rules, "Compare with…" (default the turned-on version), Turn on, Edit as new version (loads the rules into the editor, says which version it started from), Delete (confirm dialog, not for the turned-on one).
