import { useState } from "react";
import type { Api, Supplier } from "../api.js";
import { Notice } from "./Notice.js";

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/**
 * Whether the supplier's product pages need a login. Off, the app checks them with no saved login at all: no connecting,
 * automatic login or keep-alive. Turning it off keeps a saved login, so turning it on again restores it.
 */
export function NeedsLoginCard({ api, supplier, onChange }: { api: Api; supplier: Supplier; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChange();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const toggle = (needsLogin: boolean) => save(() => api.suppliers.setNeedsLogin(supplier.id, needsLogin));
  const hideAutomation = (stealth: boolean) => save(() => api.suppliers.setAutoLogin(supplier.id, { stealth }));
  const granted = supplier.automationPermission === "granted";

  return (
    <section aria-labelledby="needs-login-title" className="flex max-w-xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="needs-login-title" className="text-base font-semibold lg:text-[0.9375rem]">
            Login
          </h2>
          <p id="needs-login-hint" className="text-sm text-muted-foreground">
            Off when the supplier's product pages show stock without logging in. Keep it on if they hide stock until you log in.
          </p>
          {!supplier.needsLogin && <p className="text-sm font-medium">Checked without logging in</p>}
        </div>
        <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            aria-label="Needs a login"
            aria-describedby="needs-login-hint"
            className="size-5 accent-primary disabled:opacity-60"
            checked={supplier.needsLogin}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {supplier.needsLogin ? "Needed" : "Not needed"}
        </label>
      </div>
      {/* With a login, this switch sits with the automatic login. Without one, a website that refuses checks still needs it. */}
      {!supplier.needsLogin && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">Hide automation (stealth)</h3>
            <p id="stealth-hint-no-login" className="text-sm text-muted-foreground">
              Only for suppliers whose website refuses automatic checks. The browser hides the signs that a program is driving it on every visit to this supplier. Some suppliers’ terms forbid automated access, so using this is your call.
            </p>
            {!granted && <p className="text-sm font-medium">Needs “Allows automatic checks” to be Yes.</p>}
          </div>
          <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              role="switch"
              aria-label="Hide automation (stealth)"
              aria-describedby="stealth-hint-no-login"
              className="size-5 accent-primary disabled:opacity-60"
              checked={supplier.stealth}
              disabled={!granted || busy}
              onChange={(e) => void hideAutomation(e.target.checked)}
            />
            {supplier.stealth ? "On" : "Off"}
          </label>
        </div>
      )}
      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}
    </section>
  );
}
