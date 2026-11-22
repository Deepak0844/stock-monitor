# "Needs a login" when adding a supplier — short design

**Intent.** Today every new supplier starts as needing a login, and the owner can only change that after saving, on the supplier's page. The owner wants to choose it in the Add supplier form.

**Goals.** A "Needs a login" switch in the Add supplier form, on (Needed) by default. Off: the "Login address" field stays visible but disabled, and the new supplier is saved as needing no login.

**Non-goals.** No change to the edit form, where the Login card already holds this switch. "Fresh browser for each run" stays on the supplier's page, because it needs permission, which is also set after adding.

**Anti-goals.** The Login address field is never hidden (the owner's choice). A disabled field never blocks saving: its text is kept on screen but not sent.

**Approaches.**
- A. The POST takes an optional `needsLogin`. The server creates the supplier, then applies `setNeedsLogin(id, false)` (picked). One request, and it reuses the existing rule that a supplier with no login gets the shorter 3 s pause.
- B. The page creates the supplier, then sends a second PATCH. Two requests, and a half-done result if the second fails.

**How.**
- API `POST /api/suppliers`: optional boolean `needsLogin`. Anything else gets a 400. `false` calls `repo.setNeedsLogin(id, false)` after the create.
- Web: `SupplierInput` gains an optional `needsLogin`. The form sends it only when adding, with `loginUrl: null` when it is off.
- Placement: the switch goes between "Website address" and "Login address" (builder's call: the choice controls the field below it).
