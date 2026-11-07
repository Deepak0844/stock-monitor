# Statement of intent: supplier stock monitor

Confirmed with the owner on 2026-11-08.

## Outcome
A hosted app that checks about 15 supplier websites for stock and proposes Shopify stock changes. A Shopify change happens only after the owner approves that specific change.

## User
The store owner, as sole operator. Non-technical, so all setup happens through the UI.

## Why now
Supplier stock is checked by hand today, and out-of-stock items risk being sold.

## Success
One pilot supplier works end to end: noVNC login, scheduled check, stored quantity, status text and page state, proposal, owner approval, Shopify update, recorded result.

## Stack and approach
- React, Node, TypeScript, Playwright, PostgreSQL, Postgres-backed queue.
- Extraction recipes are saved in the database and edited in the UI as a step list. A React Flow view may come later.
- Recipes are built from captured HTML and screenshots of real supplier pages. Selectors are never guessed.
- Supplier login uses noVNC, locked down: one-time token, behind app login, isolated container, open only during a login session.
- Shopify is read and written through the Admin API. Supplier names may come from a Shopify metafield. Mappings (URL, SKU, options, region) live in the app database.

## Stock rules
- Each stock source holds a quantity (when shown), status text and page state, separate from the check result.
- Region not listed proposes 0, labelled "Not listed".
- A 404 or removed page proposes 0 after two matching checks, labelled "Page missing".
- Login redirect, CAPTCHA, block, timeout or changed page never counts as out of stock.
- Quantity above 0 proposes the owner's default quantity. A mismatch between quantity and text is flagged.

## Security
- Supplier passwords are not stored.
- Saved sessions use AES-256-GCM, one record per supplier, with the key kept outside the database.
- Sessions never appear in logs or the frontend.

## Deployment notes
- Protecting decrypted sessions depends on server hardening, a hosting concern: SSH keys only, firewall, automatic security updates, encrypted off-server backups, key outside the database and code.
- Pilot recommendation: one hardened VPS with Docker.
- Check the pilot supplier's terms on automated access.
- Database backups: nightly pg_dump to off-server storage, with tested restores.

## Multiple suppliers
The data model supports many suppliers per variant from day one. The MVP implements one supplier only, with one mapping per variant. Multi-supplier proposal logic is deferred.

## Out of scope
- Automatic Shopify updates, ever.
- Warehouse tracking.
- AI-based extraction.
- CAPTCHA bypass.
- Multi-user roles.
- Notifications beyond the dashboard.
- Suppliers 2 to 15 and multi-supplier proposal logic until the pilot is proven.

## Open items
1. Pilot supplier, sample URLs, captured HTML and screenshots.
2. Pilot supplier's terms on automated access.
3. Hosting choice.
4. Current Shopify app-setup and API details, to verify in the official docs before writing integration code.
