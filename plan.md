Act as a senior software architect and full-stack developer. Help me design and build a user-friendly supplier stock monitoring application using **React.js and Node.js with TypeScript**.

**My business**

I run a Shopify ecommerce store and work with around 15 suppliers. This number may grow.

When a customer orders, I manually check whether I have the product. Otherwise, I purchase it from a supplier and deliver it to the customer.

I do not track warehouse inventory in this application. Its purpose is to monitor supplier stock and let me review and approve changes before updating Shopify.

**Important constraints**

- Suppliers do not provide APIs or stock feeds.
- Stock information must be collected from their websites.
- Supplier websites require authentication and are protected with CAPTCHA.
- Scraping must never directly update Shopify.
- Every proposed Shopify stock change requires my approval.

**Required workflow**

Supplier website → Scheduled stock check → Save observation → Propose change → My review and approval → Update Shopify → Record result.

### 1. Supplier management

- Add, edit, enable, and disable suppliers.
- Configure each supplier’s website, stock-check interval, and authentication settings.
- Support around 15 suppliers initially, with an architecture that allows more.
- Use separate supplier adapters so differences between websites do not complicate the core application.
- Allow individual suppliers to be paused without affecting others.

### 2. Authentication and CAPTCHA

Use Playwright for authenticated browser automation where appropriate and permitted.

- Provide a guided process for opening an interactive browser session where I can manually log in and complete CAPTCHA or MFA.
- Securely save and reuse the resulting authenticated session where supported.
- Explain how this interactive login works when the application is hosted on a remote server.
- Keep each supplier’s session isolated.
- Encrypt sensitive session data and restrict access.
- Never expose passwords, cookies, tokens, or browser session data in logs or the frontend.
- Detect session expiry, login redirects, CAPTCHA challenges, and access blocks.
- When manual intervention is required, pause affected checks, notify me, and provide a clear “Reconnect supplier” action.
- Resume checks after a successful reconnection.
- Do not bypass CAPTCHA or assume that a saved session will prevent future challenges.

### 3. Product mapping

- Map a Shopify product variant to a supplier product URL and, where available, supplier SKU.
- Support multiple suppliers for the same Shopify variant.
- Check the exact product variant, including size, colour, or other options.
- Provide an easy interface to add, edit, search, and bulk import mappings.
- Detect invalid URLs, missing products, and broken mappings.
- Do not invent page selectors. Request sample supplier URLs and inspect the actual page structure before implementing an adapter.

### 4. Scheduled stock checks

- Let me configure check intervals per supplier, with optional product overrides.
- Include “Check now” for an individual product or supplier.
- Run checks through background workers.
- Use per-supplier concurrency limits, timeouts, controlled retries, and backoff.
- Avoid overlapping jobs and excessive website requests.
- Show progress and the next scheduled check.

Record:

- Latest observed availability.
- Exact supplier quantity, only when explicitly provided.
- Last successful check.
- Latest check attempt.
- Errors and stock-change history.

Keep **in stock**, **out of stock**, and **unknown** separate from the status of the check itself.

A failed login, CAPTCHA, timeout, or changed page structure must never be interpreted as “out of stock.”

### 5. Approval before Shopify updates

**This is the most important requirement: stock checks must never automatically change Shopify inventory.**

- Store supplier observations separately from Shopify inventory.
- Create a pending proposal when observations suggest a Shopify change.
- Show the current Shopify value, proposed value, supplier evidence, reason, and observation time.
- Let me approve, reject, or edit the proposed value before approval.
- Support individual and bulk approval with a clear summary.
- Repeated checks must not create duplicate pending proposals.
- If newer observations contradict a pending proposal, flag or supersede it and require review again.
- Expire stale proposals or recheck availability before applying them.
- If the recheck changes the proposed action, require a fresh approval.
- Immediately before applying an approved change, verify whether Shopify inventory has changed since review. Surface conflicts instead of silently overwriting newer values.
- Clearly distinguish pending, rejected, expired, applying, successfully applied, and failed changes.
- Record who approved each change, what was approved, and the Shopify update result.
- Retry failed updates safely without applying the same change twice.

Approval must authorize a specific Shopify change; it must not enable ongoing automatic syncing.

### 6. Stock interpretation and Shopify integration

- Do not add warehouse tracking.
- Do not assume supplier availability equals my physical inventory.
- Explain which Shopify inventory location and settings should be used for approved updates.
- Do not silently modify unrelated inventory locations or store settings.
- If a supplier only shows “in stock,” do not invent a quantity. Let me define or enter the proposed Shopify selling quantity and explain its limitations.
- If multiple suppliers stock the same product, show their statuses separately and avoid blindly adding their quantities.
- Explain how Shopify inventory tracking and “continue selling when out of stock” affect the result.
- Use Shopify’s supported API for Shopify updates; supplier collection remains website-based.
- Handle Shopify API limits, authentication errors, retries, and inventory conflicts.

### 7. User-friendly interface

Make the app understandable to a nontechnical store operator.

Use React.js with TypeScript to create:

- A dashboard showing supplier connection health, check progress, and pending approvals.
- A supplier management screen with guided connection and reconnection.
- A product-mapping screen with search, filters, and bulk import.
- An approval inbox with easy-to-compare current and proposed values.
- A history screen showing observations, approvals, and update results.
- Simple notification and check-interval settings.

Use clear labels, readable tables, helpful empty states, accessible controls, and plain-English errors. Show actions such as **“Reconnect supplier”** instead of exposing technical exceptions.

Prioritize a responsive desktop experience that also works on mobile.

### 8. Technical requirements

Use:

- **Frontend:** React.js with TypeScript.
- **Backend:** Node.js with TypeScript.
- **Browser automation:** Playwright.
- **Database:** PostgreSQL.
- **Background processing:** Recommend a suitable queue and explain why it is needed.

Keep the frontend, API, workers, supplier adapters, and Shopify integration logically separated. Use a shared TypeScript model where helpful, runtime input validation, secure secret storage, and an audit trail.

### 9. Expected response and implementation approach

First explain your understanding of the workflow in simple English.

Then provide:

1. A practical MVP architecture and data flow.
2. Database tables and their relationships.
3. The supplier-adapter interface.
4. A secure manual-login and session-reuse design, including remote hosting.
5. Scheduling, retries, and stale-data handling.
6. The approval lifecycle and conflict-handling rules.
7. Shopify integration details.
8. Main screens and user journeys.
9. A phased implementation plan.
10. Deployment options and major operating costs.

Before writing integration code, verify current official Shopify, Playwright, and relevant library documentation.

Ask only questions that genuinely block implementation. For everything else, state reasonable assumptions and proceed.

Start with one real supplier and validate the complete flow—from manual login to an approved Shopify update—before expanding to the remaining suppliers. Do not claim an adapter works until it has been tested against that supplier.

Clearly explain that supplier stock may change between checks, approval, and customer purchase. Monitoring and approval reduce outdated listings but cannot guarantee supplier availability.
