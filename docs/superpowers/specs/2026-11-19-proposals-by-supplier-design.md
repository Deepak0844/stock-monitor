# Proposals by supplier

## Intent

The owner works through suggestions one supplier at a time. Right now the Waiting tab mixes every supplier, newest first, so it is hard to see what one supplier needs.

## Goals

- A supplier picker on the Proposals page, above both tabs (Waiting and History).
- Picking a supplier shows only that supplier's suggestions. "All suppliers" shows everything, as now.
- Waiting picker shows how many are waiting per supplier, for example "EFG (12)", so the owner can see where the work is.
- The choice is kept in the address (`?supplier=<id>`), like Mappings, so it survives a reload and switching tabs.

## Non-goals

- No grouped sections or headings on one page (option B, not picked).
- No change to the cards, the table, Approve/Reject, or paging.
- No other filters.

## Approaches

- **A. Supplier picker (picked).** Server filters by supplier, so paging stays right. Matches the Mappings page.
- **B. Sections per supplier.** One page, sorted by supplier with headings. Not picked: a big supplier runs across pages.

## Design

- Server: `GET /api/proposals` takes an optional `supplierId` (UUID). `openPage` and `history`/`historyTotal` filter by it. An unknown id returns an empty list, not an error.
- Server: `GET /api/proposals/suppliers` (or the counts added to the existing list reply; builder's call) returns open counts per supplier for the Waiting picker.
- Web: a `Select` labelled "Supplier", same component and wording as Mappings ("All suppliers" first). Changing it resets to page 1.
- Suppliers come from `api.suppliers.list()`. Waiting shows the count after each name; suppliers with 0 waiting still show, as "(0)". History shows names only (my call: counts there add little).
- The empty state for one supplier says "Nothing is waiting for <name>." / "No past suggestions for <name> yet."
- The count badge in the side menu stays the total across all suppliers.

## Left to the builder

- Exact shape of the counts reply.
