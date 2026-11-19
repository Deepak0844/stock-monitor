import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Select } from "@/components/ui/input.js";
import type { Api, LoginInspection, LoginSelectors, Supplier } from "../api.js";
import { Field } from "./Field.js";
import { candidatesFor, ROLES, SAVED, selectorsFromPicks, startingPicks, type Pick, type Role } from "./loginPicks.js";
import { Notice } from "./Notice.js";

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const SENTENCES = {
  captcha: "The supplier showed a puzzle, so its login page could not be read. Log in by hand from the supplier page instead.",
  unreachable: "Could not reach the login page. Check the login address and try again.",
  none: "No login box or login button was found on this page. Check the login address. A page that is already logged in can also send you away from it.",
} as const;

type Props = { api: Api; supplier: Supplier; onSaved: (saved: LoginSelectors | null) => void };

/**
 * "Check login page": loads the supplier's login page without typing or sending anything, and lists what a login would use for
 * each part. Every row starts on Automatic, which stores nothing. A pick is saved as a selector the app made itself, and only
 * when the owner presses Save.
 */
export function LoginCheck({ api, supplier, onSaved }: Props) {
  const [result, setResult] = useState<LoginInspection | null>(null);
  const [picks, setPicks] = useState<Record<Role, Pick> | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const granted = supplier.automationPermission === "granted";

  async function check() {
    setBusy("check");
    setError(null);
    setInfo(null);
    try {
      const inspection = await api.suppliers.inspectLogin(supplier.id);
      setResult(inspection);
      setPicks(startingPicks(supplier.loginSelectors, inspection));
    } catch (e) {
      setResult(null);
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!picks) return;
    const selectors = selectorsFromPicks(picks);
    setBusy("save");
    setError(null);
    setInfo(null);
    try {
      await api.suppliers.setAutoLogin(supplier.id, { loginSelectors: selectors });
      onSaved(selectors);
      setInfo("Login fields saved.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const showRows = result && picks && (result.state === "form" || result.state === "opener");
  const rows = showRows ? ROLES.filter(({ role }) => role !== "open" || result.opened || result.found.open || supplier.loginSelectors?.open) : [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Find the login fields</h3>
        <p className="text-sm text-muted-foreground">Opens the login page and shows what the app would use. Nothing is typed or sent.</p>
        {!granted && <p id="login-check-blocked" className="text-sm font-medium">Needs “Allows automatic checks” to be Yes.</p>}
      </div>
      <div>
        <Button type="button" variant="outline" loading={busy === "check"} disabled={!granted || busy !== null} aria-describedby={granted ? undefined : "login-check-blocked"} onClick={() => void check()}>
          Check login page
        </Button>
      </div>

      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}
      {result && result.state !== "form" && result.state !== "opener" && <Notice kind="info">{SENTENCES[result.state]}</Notice>}
      {showRows && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {result.state === "opener" && <Notice kind="info">A login button was found, but pressing it showed no login boxes. Pick the right controls below.</Notice>}
          {rows.map(({ role, label }) => {
            const options = candidatesFor(result, role);
            const found = result.found[role];
            const saved = supplier.loginSelectors?.[role];
            const hint = found
              ? undefined
              : role === "account"
                ? "Not found. Most suppliers have no account field."
                : role === "open"
                  ? undefined
                  : "Not found. Pick one from the list, or leave it on Automatic.";
            return (
              <Field key={role} id={`check-${role}`} label={label} hint={hint}>
                <Select id={`check-${role}`} className="w-full" value={picks[role]} onChange={(e) => setPicks({ ...picks, [role]: e.target.value })}>
                  <option value="auto">{`Automatic: ${found ? found.label : "not found"}`}</option>
                  {options.map((c) => (
                    <option key={c.selector} value={c.selector}>
                      {c.label}
                    </option>
                  ))}
                  {saved && !options.some((c) => c.selector === saved) && <option value={`${SAVED}${saved}`}>{`Saved: ${saved}`}</option>}
                  <option value="none">Not on this page</option>
                </Select>
              </Field>
            );
          })}
          <div>
            <Button type="button" loading={busy === "save"} disabled={busy !== null} onClick={() => void save()}>
              Save choices
            </Button>
          </div>
        </div>
      )}
      {info && (
        <p role="status" className="text-sm font-medium">
          {info}
        </p>
      )}
    </div>
  );
}
