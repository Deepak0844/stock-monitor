# UI corrections, round 2: design

Approved by the owner on 2026-11-20 from `2026-11-20-ui-corrections/preview.html` ("No" changes; light C, dark B).

## Why
After the D redesign the owner still found: the supplier form and stock rules look like the old app, the top bar buttons are three identical boxes, the live login window and notification panel are bare, light mode is too bright, dark mode too dark, and the phone view is long and uneven.

## What gets built (in this order)
1. **Brightness.** Light page `#efeee9`, panels and fields `#f8f7f3`, sidebar `#e6e5df`, rules `#d8d7cf`/`#e1e0d9`, muted text `#5b5e66`. Dark page `#1b1c1a`, panels and fields `#232421`, sidebar `#161715`, rules `#33342f`/`#282925`, hover `#262724`, input border `#6e6f69`. All text pairs keep 4.5:1 (controls 3:1).
2. **Top bar.** Bell and theme switch are borderless icon buttons; the bell's count is a small red badge on its corner. Profile is a round initial that opens a menu: name and email, theme choice (Light, Dark, Same as device), Account settings, Appearance, Sign out. Phone: bell and initial only; theme in the menu.
3. **Notification panel.** Each message: an icon for its kind (login, link, stock, good news), title, one line of detail, time, and the action that fixes it ("Log in again", "See link"). Groups Today / Earlier; tabs All / Unread; footer Mark all as read and a link to email alerts. Phone: full screen.
4. **Phone layouts.** Links and Suppliers rows become short cards (name + SKU, supplier · page, status and stock on one line, buttons). Filters fold into one "Filters · N" button opening a full-screen sheet; chosen filters show as removable chips. Dashboard tile links are short ("See suppliers").
5. **Supplier edit form.** Header with name, status, website, last check, and Stock rules / Check connection. Left index of the parts with each part's state; each part is title + explanation left, fields right; switches are rows with their state; one save bar at the bottom for the part that changed (each part still saves through its own existing API call).
6. **Stock rules.** Three steps across the top (save example pages, write the rules, test and turn on) with their state; each rule is one sentence of fields; example pages and versions in a right-hand column.
7. **Live login window.** A browser-like frame with the supplier's address and a green Live sign; a guide on the left with the three steps, I'm logged in, Cancel and a time-left bar. Phone: window fills the screen, I'm logged in pinned at the bottom.

## Not changing
What each screen does, its API calls, its words where the preview does not change them, and every accessibility test (axe in light and dark, phone and desktop, no sideways scroll).

## Approaches
Restyle the existing React pages in place with the D components (chosen: no behaviour change, the tests keep guarding behaviour) versus rebuilding the pages (rejected: risks the behaviour the owner relies on).

## Left to the builder
Exact spacing, icons (lucide), and how the single save bar finds which part changed.
