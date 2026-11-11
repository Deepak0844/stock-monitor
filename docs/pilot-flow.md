# Pilot run: the whole flow

Step by step, from an empty app to stock suggestions. It covers adding a supplier, adding links (the page for each product at the supplier) and checking stock. No supplier names or addresses are written here because the repository is public. Use your own.

Do the steps in order. Each one depends on the one before.

## Phase 0. Get the app running

1. In the repo folder: `git pull`, then `docker compose up -d --build`. Migrations run by themselves.
2. Check `docker compose ps`. All services must be running, and `browser` must be healthy.
3. `.env` must have `BROWSER_CONTROL_TOKEN`. Set `BROWSER_TIMEZONE` (for example `Asia/Kolkata`) and `BROWSER_LANGUAGE` (for example `en-IN`) so the browser matches where you really are. After changing them run `docker compose up -d`.
4. Open http://127.0.0.1:3000 and sign in. If you have no owner yet: `docker compose run --rm api node --import tsx apps/api/src/cli/create-owner.ts`.

## Phase 1. Permission (before any supplier is visited)

The supplier's terms decide whether automatic checks are allowed. This is your call, not the app's.

1. Read the supplier's terms for words like robots, bots, scraping or automated access. Also read its `robots.txt`.
2. If the terms forbid automated access, ask the supplier in writing for permission or for a stock feed. Without that, do not go on with this supplier.
3. Note the pause between pages that `robots.txt` asks for (its crawl-delay). You enter it later.

## Phase 2. Connect Shopify and load your products

1. Create the Shopify app and get its client ID and secret. Use a development store first if you plan to let the app change stock (see Phase 9). Steps (from Shopify's Dev Dashboard guide; button names may change):
   1. Sign in at dev.shopify.com/dashboard with the account that owns the store. Check the store is listed under the same organization as your apps. The client ID and secret only work for a store in the same organization.
   2. On **Apps**, press **Create app**, then **Start from Dev Dashboard**. Enter a name such as "Stock Monitor" and press **Create**.
   3. On the app's **Versions** page fill in **App URL** (the default `https://shopify.dev/apps/default-app-home` is fine because the app is not embedded) and leave **Webhooks API version** on the newest. In **Scopes** enter only `read_products,read_inventory` (add `read_locations` only if the connection test says locations are missing). Do **not** add `write_inventory` yet. Press **Release**.
   4. Press **Install app** (top of the **Installs** card). Choose your store and press **Install**.
   5. Open the app's **Settings** page. Copy the **Client ID** and **Client secret**. Keep the secret out of files and chats.
   6. If you later add a scope in a new version, release it and approve the change in the store's admin, then press **Connect** again in the app.
2. In the app, open **Settings**. Under **Connect your Shopify store** enter **Store address** (`my-store.myshopify.com`) and the app's client ID and secret (or an access token). Press **Test**, then **Connect**.
3. Under **Inventory location**, choose the location whose stock you want watched.
4. Under **Sync**, press **Sync**. Wait until it finishes.
5. Open **Products**. Your products, variants, SKUs and available numbers must be listed. If not, fix this first. Links in Phase 4 match your variants by **SKU**.

## Phase 3. Add the supplier and log in

1. Open **Suppliers**, then **Add supplier**.
   - **Name:** use exactly the name your Shopify export holds for this supplier (see Phase 4). Capitals do not matter.
   - **Website address:** the supplier's site, starting with `https://`.
   - **Login address:** only if the login page is somewhere else.
   - Save.
2. On the supplier's row press **Connect**. A live window opens, showing the supplier's real site.
3. Log in yourself, as you normally would. Solve any puzzle or code. Click inside the window to type. To paste a password, use **Paste text**, then **Send to the window**, click the field, press Ctrl+V.
4. When you see you are logged in, press **I'm logged in**. You have 15 minutes. Cancel or timeout saves nothing.
5. The supplier must show **Connected** after a few seconds. Press **Check connection** to confirm.
   - **Blocked:** the supplier's bot protection refused the automatic check. The app will not retry it. Options: ask the supplier for a feed, or leave it paused.
   - **Needs reconnecting:** press **Reconnect supplier** and log in again.
6. If the puzzle rejects you in the live window although your own browser is accepted, set `LOGIN_WINDOW_MODE=plain` in `.env` and run `docker compose up -d browser`.

## Phase 4. Record permission and the pause between pages

1. Open the supplier's **Edit** page.
2. In **Permission to check automatically** choose **Allowed**. Add a note (who you asked and when).
3. Set **pause between pages** in seconds, at least the crawl-delay from Phase 1.
4. Save. Until this says **Allowed**, every check, capture and rule test is refused. **Not allowed** and **Not recorded** both block.

## Phase 5. Add links

A link ties one Shopify variant to one page at the supplier. One link per variant. Several variants may share one page.

### Option 0. From Shopify itself (the metafields)

If a product already has the supplier name and the supplier page address (SPU) in Shopify, **Sync** sets its link by itself. **Shopify is the one source** for those products.

1. In Shopify admin, **Settings > Custom data > Products**, note the names of the two metafields as `namespace.key` (the defaults the app looks for are `custom.supplier_name` and `custom.spu`). If yours differ, set `SHOPIFY_SUPPLIER_NAME_METAFIELD` and `SHOPIFY_SPU_METAFIELD` in `.env`, then run `docker compose up -d`.
2. Add the supplier in the app first (Phase 3). Its **name** must match the metafield (capitals do not matter) and its **website address** must be the site the SPU is on.
3. **Settings > Sync from Shopify**. The Sync card then says "Links from Shopify: 12 added, 3 updated, 2 skipped" and lists each skipped product with the reason. Fix those in Shopify and sync again.
4. Products with no supplier fields in Shopify keep whatever link they have. Add those with Option A (CSV) or Option B (by hand).
5. A hand edit on a link set from Shopify is undone by the next sync. The edit page warns about it. The CSV import skips those products and says how many.

### Option A. Import from your Shopify export (many links, for products without Shopify fields)

1. In Shopify: **Products > Export**, all products, plain CSV. The file must contain the variant SKU, the supplier name and the supplier page address for each variant. Your layout has the supplier name in the `custom.supplier_name` column and the address inside the **Conversation starters** column.
2. In the app open **Links**, then **Import**.
3. **1. Choose the file:** pick the CSV (up to 10 MB).
4. **2. Check the columns:** the app guesses. Confirm or change:
   - **SKU column** (usually `Variant SKU`)
   - **Supplier name column**
   - **Page address column** (the column holding the address)
   - **Product handle column** (usually `Handle`; it lets a product's supplier and address carry down to its other variants)
   Press **Show preview**.
5. **3. Preview.** Nothing is saved yet. Read it:
   - how many links are ready, and how many are new, replaced or unchanged
   - rows for suppliers not in the app are skipped, not errors
   - the problem list, with the line and a reason, for example "SKU matches no variant" or "that address is not on this supplier's website"
   - the app removes the tracking parts `_pos`, `_psq`, `_psid` and `_ss` from addresses and keeps everything else, such as `?variant=`
6. If the problems are real, fix the CSV (or add the supplier, or sync Shopify) and import again. Importing the same file again is safe: it updates, never duplicates.
7. Press **Save N links**. The result shows created, replaced, unchanged and skipped.

### Option B. One link by hand

1. **Links > Add link**.
2. Find the variant (**Find a variant**, then **Variant**), choose the **Supplier**, and enter the **Supplier page address**. **Note** and **Region** are optional. Region is only for suppliers that list stock by region.
3. Save.

## Phase 6. Check that each link works

1. On **Links**, choose the supplier in the filter.
2. Try **Check now** on one link first. Look at the **Status** column.
3. Then **Check all links** for the supplier. It goes one page at a time, with your pause between pages.
4. Link statuses:
   - **Working:** the page loaded.
   - **Never worked:** wrong address. Edit the link.
   - **Page missing:** the page was not found, or went to the home page, and it worked before. See Phase 8: this is a candidate for "unavailable" only after two checks at least 6 hours apart.
   - **Moved**, **Could not check:** read the reason shown. A login, puzzle, block or unreachable site is never counted as a broken link.
5. If a login, puzzle or block message appears, the run stops at once and a message shows on the Dashboard. Reconnect the supplier (Phase 3).

## Phase 7. Teach the app to read stock

Stock rules say how this supplier's page shows stock. You write them once per supplier, from a saved copy of a real page. Nothing is clicked or changed on the supplier's site.

1. **Suppliers**, then **Stock rules** on the supplier's row.
2. **Capture a page:** pick a link and press **Capture a page**. Press **View** to see the saved words. Capture at least one page that is in stock and one that is out of stock.
3. **Label examples:** for each saved page choose the answer you expect and press **Save label**.
4. **Build the rules.** Each rule asks one question: text on the page, or a button on the page (and whether it must be enabled).
   - **Page checks:** words that must be on every normal product page. If missing, the answer is Cannot tell.
   - **In stock when / Out of stock when:** any one match decides. Both or neither gives Cannot tell.
   - **Quantity (optional):** a number following a label such as "Units left".
   - **Region (optional):** only for a supplier that lists stock by region.
   - Limit a rule to the part under a heading when other products on the page could confuse it.
5. **Test all examples.** Every labelled example must pass.
6. **Save version**, then **Turn on**. Turning on is only possible when all examples pass.
7. Check it for real: on **Links** press **Check stock** on one link, then **Check all stock** for the supplier. The **Stock** column shows **In stock (n)**, **Out of stock** or **Cannot tell** with the reason. **Cannot tell** is never treated as out of stock. **History** on a link shows earlier answers.
8. If stock only appears after a click or a scroll, version one cannot read it.

The next section, "Stock rules in detail", walks through each screen with worked examples. Read it before you write the first rule. The wording in the examples is made up: always use the words your own supplier's saved page shows.

## Phase 8. Automatic checks

1. Supplier **Edit** page, **Automatic checks**.
2. **How often:** start with **every day**. Shorter means more visits to a supplier that may not want them.
3. **Hours of the day:** 07:00 to 22:00 by default. **Any time of day** removes the limit.
4. Turn it on. A supplier is only checked automatically when it is connected, running (not paused), **Allowed**, and has stock rules turned on. The Suppliers list says why when it is not.
5. Watch the first runs on **Suppliers** ("Checking 12 of 40 links") and in the run history on the supplier's Edit page.
6. What stops a run: login needed, puzzle or block (stops at once, never retried, needs you to reconnect); three unreachable pages in a row (retry after 15 minutes, 1 hour, then 4 hours); the app restarting.
7. Turn this on for the pilot supplier only.

"Page missing" and the owner's rule for the pilot: a missing page, or a redirect to the home page, on a link that worked before means "may be unavailable". The app only suggests setting stock to 0 after two such checks at least 6 hours apart, and nothing is changed without your approval.

## Phase 9. Suggestions and writing stock back to Shopify

After each stock check the app compares the supplier's answer with Shopify's available number and adds a suggestion to **Proposals** when they disagree in a way that matters.

| Supplier said | Shopify shows | Suggestion |
|---|---|---|
| Out of stock | more than 0 | Set to 0 |
| Page missing (two checks, 6 hours apart) | more than 0 | Set to 0 |
| In stock | 0 | Set to the back-in-stock quantity (5 to start with) |
| In stock and Shopify above 0, or both out of stock | | Nothing |
| Cannot tell | | Nothing, ever |

1. Open **Proposals**. Each suggestion shows the product, what the supplier said and when, what Shopify shows, and the suggested number.
2. **Approve** one suggestion at a time (there is no approve-all), **Edit number** first if you want, or **Reject**. Nothing changes in Shopify until you approve.
3. Approve is disabled, with the reason, when Shopify is not tracking the item or the app has no permission to change stock.
4. Settings holds the back-in-stock quantity and how long a suggestion stays open (24 hours).
5. If Shopify's number changed after the suggestion was made, nothing is written and the suggestion says "Not applied: Shopify changed".

**Writing needs `write_inventory`.** Add that permission to your Shopify app, then press **Connect** again in Settings. It has been tested only against a stand-in Shopify, not a real one. **Do the first approvals on a Shopify development store, not your real store.** The checklist is in `docs/deployment.md`, "Checking it against a real Shopify store". Until you have done it, you can run the whole pilot without `write_inventory`: suggestions appear, Approve is refused, and nothing is sent.

## Stock rules in detail

### How the app reads a page

When you capture a page, the app saves the **words** on it, split into sections under the page's headings, plus a list of its **buttons** (label, enabled or disabled, and the heading each sits under). It never reads the picture. Your rules are tested against those words and buttons only.

How a rule matches:

- **Text rule:** matches when any line on the page **contains** your words. Capitals do not matter and extra spaces are ignored. "out of stock" matches "Currently OUT OF STOCK." A heading counts as a line too.
- **Button rule:** matches when any button's label **contains** your words. Optionally the button must be **Enabled** or **Disabled**. **Either** ignores that.
- **Only under this heading (optional):** limits the rule to one part of the page. The app finds the **first** heading that contains your words, then looks at that section and the sub-sections below it, up to the next heading of the same or higher level. If no heading matches, the rule finds nothing.

How the answer is decided, in this order:

1. **Page checks.** Every one must match. If any is missing, the answer is **Cannot tell** ("page changed").
2. **Region** (only if you turned it on and a region is set): the answer comes from the region's number. See example 4.
3. **In stock when / Out of stock when:** any one rule in a list matching counts.
   - Only in-stock matches: **In stock**.
   - Only out-of-stock matches: **Out of stock**.
   - Both match: **Cannot tell** ("rules disagree").
   - Neither matches: **Cannot tell**, unless a quantity was read. Then a number above 0 means In stock and 0 means Out of stock.
4. **Quantity** is a cross-check. If the words say in stock but the number is 0 (or the reverse), the answer is **Cannot tell** ("quantity and wording disagree").

So the app says In stock or Out of stock only when the rules agree clearly. Everything else is Cannot tell, and Cannot tell is never turned into a stock change.

### Step by step, on the Stock rules screen

**A. Capture example pages**

1. **Suppliers**, then **Stock rules** on the supplier's row.
2. Under **Saved pages** choose a link in **Link to capture**. Optionally type a **Name** such as "Blue widget, in stock". Press **Capture a page**. Wait a few seconds for it to appear.
3. Capture **at least three pages**: one clearly in stock, one clearly out of stock, and a second of each if you can. If the supplier shows a low-stock message, a pre-order, or a quantity, capture one of those too.
4. Press **View** on each. Read **What the page said** and **Buttons**. Write down the exact words that tell you the stock state, and which heading they are under. Compare an in-stock page with a sold-out page: the words that differ are your rules.

**B. Label the examples**

1. With a page open (**View**), set **Answer you expect** to In stock, Out of stock, or Cannot tell, and press **Save label**. A **Name** can be changed there too.
2. Label every capture you will test with. Unlabelled ones are ignored by **Test all examples** and are deleted after 30 days.
3. Use **Cannot tell** as the label for a page where the stock genuinely cannot be seen (for example a page that is not a product page). It proves the rules do not guess.

**C. Write the rules** (under **Rules**)

1. **Page checks.** Press **Add a rule to Page checks** until you have one or two. Pick words that are on **every** normal product page, in stock or not, such as a "Product code" label or "Add to wishlist". Do not use stock words here. The editor refuses to save without at least one page check.
2. **In stock when.** Add the words or button that appear only when stock is available.
3. **Out of stock when.** Add the words or button that appear only when it is sold out.
4. For each rule choose the **type** (**Text on the page** or **Button on the page**), type the **words**, and for a button choose **Either / Enabled / Disabled**. Use the **only under this heading** box when a part of the page could confuse the rule.
5. Rows left empty are dropped. A list may have up to 10 rules.
6. Use **Remove** next to a rule to delete it.

**D. Test**

1. Press **Test all examples**.
2. Each labelled example shows the answer the rules gave and whether it matches your label, with the matching words or the reason.
3. Fix and test again until every example passes. Typical fixes:
   - "Page changed": a page check is on that page but worded differently, or missing. Use a safer page check.
   - "Rules disagree": your in-stock and out-of-stock words both appear. Tighten one with **only under this heading**, or pick more specific words.
   - "Neither matched": no rule found the words. Check spelling against **What the page said**, or add the missing rule.
   - "Quantity and wording disagree": the quantity label points at the wrong number, or the wording rule is too loose.

**E. Save and turn on**

1. Press **Save version**. This creates the next version number and never turns anything on or edits an old version.
2. Under **Versions** press **Turn on** on the version you want. It is refused until every labelled example passes, and the screen says why.
3. A new version leaves the old one active until you turn the new one on. To change rules later, edit, test, save a new version, and turn it on.

**F. Prove it on live links**

1. **Links**, choose the supplier, and press **Check stock** on one link you know is in stock. Then on one you know is sold out.
2. Compare with the supplier's page in your own browser. **History** on the link shows the answer and the rules version.
3. Only then press **Check all stock**, or turn on Automatic checks.

### Worked example 1: a plain page with a button and a badge

Suppose the saved in-stock page shows the button **Add to cart** (enabled), and the saved sold-out page shows the text **Out of stock** and a **disabled** button **Add to cart**. Both show **Product code** and **Add to wishlist**.

- **Page checks:** text rule, words `Product code`.
- **In stock when:** button rule, words `Add to cart`, button must be **Enabled**.
- **Out of stock when:** text rule, words `Out of stock`.

What happens:

- In-stock page: the Add to cart button is enabled, so In stock matches. The text "Out of stock" is absent, so only one side matches: **In stock**.
- Sold-out page: the button is disabled, so it does not match "Enabled". The text matches: **Out of stock**.
- A page without "Product code": **Cannot tell** (page changed).

Why "Enabled" matters: a sold-out page often keeps the Add to cart button but disabled. Without that setting, the rule would call it in stock.

### Worked example 2: a "Sold out" badge on a related product

Problem: the in-stock page has a "Related products" section where another item shows **Sold out**. A rule with text `Sold out` would match the in-stock page too, and the answer would be **Cannot tell** (both matched).

Fix: limit the rule to the main product's section.

1. Open **View** on the saved in-stock page. In **What the page said**, find the heading above the main product's details, for example **Product details**, and the heading above the related items, for example **You may also like**.
2. **Out of stock when:** text rule, words `Sold out`, **only under this heading:** `Product details`.
3. Press **Test all examples**. The in-stock page now ignores the badge under **You may also like**.

Notes: heading words are matched by "contains", and the **first** heading that matches is used, so choose words that appear in only one heading. A heading with the same level that follows ends the section.

### Worked example 3: reading a quantity

The in-stock page shows **Units left: 12** and the sold-out page shows **Units left: 0**. There is also a text **In stock**.

- **Page checks:** text rule `Product code`.
- **In stock when:** text rule `In stock`.
- **Out of stock when:** text rule `Out of stock`.
- **Quantity:** tick **Read a quantity**, **Quantity label** `Units left`.

What happens:

- The app finds the number straight after the label: `Units left: 12` gives 12, so the answer is **In stock (12)**. The same works for `Units left 12`, `Units left = 12`, `Units left: Only 3` and a table row with the label in the first cell and the number in the next.
- If a page says **In stock** but **Units left: 0**, the answer is **Cannot tell** (wording and quantity disagree). The number is recorded for you to see.
- If neither the in-stock nor out-of-stock rule matches but the quantity is read, the quantity decides: above 0 In stock, 0 Out of stock.
- A label that only starts a longer word is not a match, for example `Bristol` does not match `Bristol North 4`.

The quantity is shown in the Stock column. Stock changes in Shopify only ever come from a clear answer that you approve, never from a guess.

### Worked example 4: stock by region

Some suppliers list stock per warehouse in a table:

```
Stock by region
Cardiff        0
Glasgow        1,204
London         37
```

1. Capture an in-stock page and an out-of-stock page for the region you sell from.
2. **Rules:** keep **Page checks**. Tick **This supplier lists stock by region**. In **Region table heading** type `Stock by region`.
3. Choose the region itself on the supplier's **Edit** page (the default for all its links) or on each link in **Links** (the **Region** box).
4. Label your examples and **Test all examples**.

What happens:

- The region's row gives the number: above 0 **In stock (number)**, 0 **Out of stock**.
- A region that is **missing** from the table is **Out of stock** ("not listed"), but only while the table's other rows are still there. If the whole table is gone, the answer is **Cannot tell** (page changed), because the page probably changed.
- When a region is set, the region number decides. The in-stock and out-of-stock lists are not used for that supplier.
- If no region is set on the supplier or the link, the ordinary rules decide.

### Tips

- **Compare the two captures side by side.** The words that appear on one and not the other are your rules.
- **Prefer short, stable words** such as `Out of stock` over a full sentence that the supplier might reword.
- **Do not use `stock` alone** in the out-of-stock list. It also appears on in-stock pages ("In stock"). Use `Out of stock` or `Sold out`.
- **Pick page checks that cannot change with stock**, such as a product-code label or "Add to wishlist". If the page check were a stock word, every sold-out page would look like a changed page.
- **Capture more pages for tricky states:** low stock, pre-order, discontinued, "notify me". Label each with the answer you want. If you want one of them to be Cannot tell, label it Cannot tell.
- **Keep the examples.** Labelled examples are what proves a new version still works.
- **When the page changes:** the Dashboard says "<supplier>'s pages changed. Review its stock rules." Capture a new page, change the rules, test, save a new version, and turn it on.
- **A 404 or a redirect to the home page** is not a rules question. It shows as "Page missing" on the link.

## Daily use during the pilot

1. Dashboard: read **Needs attention** (reconnect a supplier, review stock rules, a suggestion that needs a look).
2. **Proposals:** approve or reject.
3. **Suppliers:** check that the status is **Connected** and the last run result looks normal.
4. When a supplier's pages change, the Dashboard says "<supplier>'s pages changed. Review its stock rules." Open the rules, re-capture, adjust, test and turn on a new version.

## Quick fixes

| Problem | Do this |
|---|---|
| Import says "SKU matches no variant" | Sync Shopify (Settings > Sync), or the SKU is wrong in the CSV. |
| Rows skipped as "not in the app" | The supplier name in the CSV does not match the supplier name in the app. |
| "That address is not on this supplier's website" | The link points to another domain than the supplier's website address. Fix the address, or the supplier's website address. |
| Check refused | The supplier is not **Allowed**, not connected, or paused. The message says which. |
| Needs reconnecting | **Reconnect supplier**, log in, **I'm logged in**. |
| Blocked | The supplier's bot protection refused the check. Do not retry. Ask for a feed or leave it paused. |
| Cannot tell | Read the reason. Page changed: update the rules. Login, puzzle, block: reconnect. |
| Live window will not open | `docker compose ps`: is `browser` healthy? Only one login window can be open at a time. |

## Rules to keep during the pilot

- Check the terms and record **Allowed** before anything is visited.
- Never ask the app to solve a puzzle or hide that it is a program. It does neither.
- Start with one supplier and one link, then a few, then all.
- Never put supplier names or addresses in files that go into the repository.
