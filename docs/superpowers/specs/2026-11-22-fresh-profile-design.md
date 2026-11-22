# Fresh browser for each run — short design

**Intent.** Booker needs no login. On GCP, the first run with a new kept browser profile works, and every later run gets Akamai's 403. That happens because the protection marks the profile's cookie after the first visit. The owner wants Booker's checks to keep working from GCP, and will check it less often.

**Goals.** A per-supplier switch, "Fresh browser for each run". When it is on, every run, and every single-page visit, starts from an empty browser profile.

**Non-goals.** No retries after a refusal, no change to suppliers that need a login, no change to the live window.

**Anti-goals.** Never log a supplier out. Never loop on refusals: if a fresh run is still refused, the supplier pauses as today.

**Constraints.** Off by default. Needs "Allows automatic checks" = Yes, like stealth: losing permission turns it off. Used only when the supplier needs no login. Only profile mode keeps profiles; headless mode already starts clean, so there it does nothing.

**Approaches.**
- A. Wipe before each run (picked by the owner): no refused visit to cause it, and it matches what was seen (the first run works).
- B. Wipe after a refusal, then retry: one refused visit every run, plus an instant retry, which is the pattern that gets an address blocked.

**How.**
- `suppliers.fresh_profile` boolean, default false, with a check that it needs `granted`. Set through the same PATCH as stealth.
- The worker sends `freshProfile: true` to the browser service on the first page of a run, on a single-link stock check, on a stock-rules capture, and on a link check. This applies when the supplier has the switch on and needs no login.
- The browser service, in profile mode, wipes and re-seeds that site's profile before the visit when `freshProfile` is set.
- Builder's call: with the switch on, the supplier skips quick reads (plain downloads), as stealth suppliers already do. From GCP every quick read to Booker gets a 403, which is needless refused traffic.
- Web: the Login card shows the switch when no login is needed, disabled until permission is Yes.
