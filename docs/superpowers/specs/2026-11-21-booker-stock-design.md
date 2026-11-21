# Booker stock from its page script — short design

**Intent.** Booker (UK wholesaler) does not put stock in schema.org data. It keeps it in the inline module script that draws the product (`ProductDetailHero`), as `"availability":{"status":"inStock"}` or `"outOfStock"`. The owner wants Booker checked like other suppliers.

**Goals.** Both page readers (browser check and plain download) turn that status into one normal offer, so the existing built-in data logic answers for Booker.

**Non-goals.** No new UI, no new rule type, no reading of other Booker fields (price, branch, quantity).

**Anti-goals.** Never answer from another product's script (related products, carousels).

**Approaches.**
- A. Read only the script that mounts `ProductDetailHero` (picked): precise; if Booker renames it, the answer is "cannot tell", never wrong.
- B. Read any inline script with an `availability.status`: catches renames, but can answer from a related product's data.
- C. Rely on the owner's word rules on the drawn "In Stock" text: no code, but a plain download sees no drawn text.

**How.**
- `capture.ts` and `quick-read.ts` also pass on inline scripts whose text contains `ProductDetailHero`, through the same list and size limits as JSON-LD scripts.
- `offersFrom` reads such a script by pattern: the first `"availability":{"status":"…"}` gives the availability, `"sucode"` the SKU. `inStock` / `outOfStock` already map (case is ignored); any other value is "cannot tell".
- The owner turns on "built-in data" for Booker in its stock rules.

**Builder's call.** Offer `name` left null (one offer answers without it).

**Caveat.** Logged-out pages show stock for a default branch (`rtsPostcode` LS12 6HU), not necessarily the owner's.
