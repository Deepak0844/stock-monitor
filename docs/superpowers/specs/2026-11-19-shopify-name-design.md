# Name in Shopify: a supplier's own matching name

Date: 2026-11-19. Status: approved by the owner (small change).

## Intent

Products are linked to a supplier by the supplier name in Shopify (`custom.supplier_name`, and the `supplier_name` column of
a Shopify export). Today that name must equal the supplier's name in the app, so the app name cannot be chosen freely and a
different spelling breaks the link. The owner wants one more field that holds the name Shopify uses.

## Design

- `suppliers.shopify_name text null` (1-200 characters). The supplier's **match name** is `shopify_name` when set, else
  `name`, compared trimmed and lower case.
- A unique index on `lower(coalesce(shopify_name, name))`: two suppliers can never share a match name. A clash is refused with
  `409 shopify_name_taken`: "Another supplier already uses that name for Shopify matching." (constraint
  `suppliers_match_name_unique`). The existing unique app name stays.
- `supplierMatchName(s)` in `@stock-monitor/mapping` is the one rule; the Shopify sync (`apps/worker/src/shopify-sync.ts`) and
  the export import (`apps/api/src/routes/mapping-import.ts`) both key their supplier map by it.
- API: supplier create and update accept `shopifyName` (string, empty or null clears it; over 200 characters is
  `invalid_shopify_name`). Supplier JSON has `shopifyName`.
- Web: "Name in Shopify (optional)" under Name on the supplier form, hint "The supplier name your Shopify products use (the
  custom.supplier_name field). Leave it empty if it is the same as the name above."
- Unchanged: the address check, everything else. Suppliers without the field behave exactly as before.

## Approaches

1. One optional field per supplier (chosen by the owner). 2. Match by the page address alone (no name). 3. A list of extra
names. The owner chose 1.

## Plan (one task each, test first)

1. DB: column, checks, index, repository create/update + `shopify_name_taken`.
2. `supplierMatchName` + sync and import keyed by it.
3. API create/update validation and the 409.
4. Web field and error.
5. Docs (pilot flow Phase 3 and Phase 5), full check.
