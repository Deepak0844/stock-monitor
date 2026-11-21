# Booker Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Booker's stock status from its `ProductDetailHero` page script as a built-in offer.

**Architecture:** Page readers pass the script text in the existing `ldScripts` list; `offersFrom` recognises it and pulls one offer by pattern. No type or API changes.

**Tech Stack:** TypeScript, vitest, Playwright (browser tests).

**Spec:** `docs/superpowers/specs/2026-11-21-booker-stock-design.md`

## Global Constraints

- Marker string: `ProductDetailHero`. Status pattern: first `"availability"\s*:\s*\{\s*"status"\s*:\s*"([A-Za-z]{1,40})"`. SKU: `"sucode"\s*:\s*(\d{1,20})`.
- Same limits as JSON-LD: script ≤ 1,000,000 chars, all scripts ≤ 2,000,000.

## Review Focus

- A JSON-LD script and a Booker script on one page: both offers kept.
- Booker script with `realtimeStockMappedStatus: null` (out of stock sample): still reads `outOfStock`.
- Inline script with `availability.status` but no `ProductDetailHero`: ignored.
- Unknown status (e.g. `lowStock`): kept as offer; downstream says "cannot tell" (existing `availabilityAnswer`).
- Script with marker but no status: no offer.

---

### Task 1: `offersFrom` reads the Booker script

**Files:** Modify `services/browser/src/offers.ts`; Test `services/browser/src/offers.test.ts`

**Interfaces:** Produces: `offersFrom(jsonTexts, microdata, pageUrl)` unchanged signature; a text containing `ProductDetailHero` yields `{ availability: <status>, url: null, sku: <sucode>, name: null }`.

- [ ] Tests (trimmed fixtures from the owner's two pasted scripts): in stock gives `[{ availability: "inStock", url: null, sku: "303983", name: null }]`; out of stock gives `availability: "outOfStock", sku: "302148"`; script without marker gives `[]`; marker without status gives `[]`; Booker + JSON-LD gives both.
- [ ] Run `npx vitest run services/browser/src/offers.test.ts`: new tests FAIL.
- [ ] Implement: in the `jsonTexts` loop, a text containing the marker goes to the pattern reader instead of `JSON.parse`.
- [ ] Run again: PASS. Commit.

### Task 2: both page readers pass the script on

**Files:** Modify `services/browser/src/quick-read.ts:89`, `services/browser/src/capture.ts:83`; Test `services/browser/src/quick-read.test.ts`, `services/browser/test/offers.browser.test.ts`

- [ ] Tests: quick read of a page holding the in-stock Booker script gives `offers: [{ availability: "inStock", sku: "303983" }]`; same through a real page in the browser test.
- [ ] Run: FAIL.
- [ ] Implement: quick read keeps a `<script>` body when the tag is JSON-LD **or** the body contains the marker; capture queries `script` elements and keeps JSON-LD ones or ones whose text contains the marker. Same limits.
- [ ] Run unit + browser tests: PASS. Run `npm run typecheck` and `npm run lint`. Commit.
