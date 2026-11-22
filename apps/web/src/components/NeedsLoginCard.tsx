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
  const setFresh = (freshProfile: boolean) => save(() => api.suppliers.setAutoLogin(supplier.id, { freshProfile }));
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
      {!supplier.needsLogin && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">Fresh browser for each run</h3>
            <p id="fresh-profile-hint" className="text-sm text-muted-foreground">
              Starts every check of this supplier with a browser that keeps nothing from earlier visits. For a website that works on the first check and refuses the next ones. The supplier’s terms may not allow automated checks, so using this is your call.
            </p>
            {!granted && <p className="text-sm font-medium">Needs “Allows automatic checks” to be Yes.</p>}
          </div>
          <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              role="switch"
              aria-label="Fresh browser for each run"
              aria-describedby="fresh-profile-hint"
              className="size-5 accent-primary disabled:opacity-60"
              checked={supplier.freshProfile}
              disabled={!granted || busy}
              onChange={(e) => void setFresh(e.target.checked)}
            />
            {supplier.freshProfile ? "On" : "Off"}
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
