import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import type { Api, AutoLoginResult, LoginSelectors, Supplier } from "../api.js";
import { formatDay, formatWhen } from "../format.js";
import { Field } from "./Field.js";
import { Notice } from "./Notice.js";

const RESULT_WORDS: Record<AutoLoginResult, string> = {
  ok: "logged in",
  captcha: "puzzle shown",
  code_required: "asked for a code",
  wrong_password: "password refused",
  account_locked: "account locked",
  blocked: "blocked",
  form_not_found: "login form not found",
  unreachable: "could not reach the site",
  unknown: "not sure it worked",
};
const PAUSE_WORDS: Record<NonNullable<Supplier["autoLoginPausedReason"]>, string> = {
  wrong_password: "The supplier refused the saved password",
  account_locked: "The supplier says the account is locked",
  too_many_failures: "Two automatic logins failed in a row",
};
const SELECTOR_FIELDS: { key: keyof LoginSelectors; label: string }[] = [
  { key: "open", label: "Open login button" },
  { key: "account", label: "Account field" },
  { key: "username", label: "Username field" },
  { key: "password", label: "Password field" },
  { key: "submit", label: "Login button" },
];

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

const POLL_EVERY_MS = 15_000;
const POLL_FOR_MS = 90_000;

/** Saves a supplier login and turns on automatic login. A saved username or password is never shown again. */
export function AutoLoginCard({ api, supplier, onChange }: { api: Api; supplier: Supplier; onChange: () => void }) {
  const [account, setAccount] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectors, setSelectors] = useState<Record<keyof LoginSelectors, string>>({
    open: supplier.loginSelectors?.open ?? "",
    account: supplier.loginSelectors?.account ?? "",
    username: supplier.loginSelectors?.username ?? "",
    password: supplier.loginSelectors?.password ?? "",
    submit: supplier.loginSelectors?.submit ?? "",
  });
  const [savedAt, setSavedAt] = useState(supplier.credentialsSavedAt);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // After a test starts, ask the page to reload every 15 s for up to 90 s, until the last login time changes.
  const [testFrom, setTestFrom] = useState<{ at: string | null } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!testFrom) return;
    const timer = setInterval(() => onChangeRef.current(), POLL_EVERY_MS);
    const stop = setTimeout(() => setTestFrom(null), POLL_FOR_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [testFrom]);
  useEffect(() => {
    if (testFrom && supplier.lastAutoLoginAt !== testFrom.at) setTestFrom(null);
  }, [supplier.lastAutoLoginAt, testFrom]);

  const granted = supplier.automationPermission === "granted";
  const paused = supplier.autoLoginPausedReason;
  // The test job logs in only when automatic login is on and not paused, so the button says what to do first.
  const testBlocked = !supplier.autoLogin ? "Turn on automatic login first." : paused ? "Press Resume first." : null;

  /** Runs one action: shows one error or note, never both, and tells the page to reload. */
  async function run(name: string, action: () => Promise<string | null | void>) {
    setBusy(name);
    setError(null);
    setInfo(null);
    try {
      const note = await action();
      if (note) setInfo(note);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return setError("Enter a username and a password.");
    void run("save", async () => {
      const result = await api.suppliers.saveCredentials(supplier.id, { username: username.trim(), password, ...(account.trim() ? { account: account.trim() } : {}) });
      setSavedAt(result.savedAt);
      setAccount("");
      setUsername("");
      setPassword("");
      onChange();
      return "Login saved.";
    });
  };

  const remove = () =>
    void run("remove", async () => {
      await api.suppliers.removeCredentials(supplier.id);
      setSavedAt(null);
      onChange();
    });

  const toggle = (on: boolean) =>
    void run("switch", async () => {
      await api.suppliers.setAutoLogin(supplier.id, { autoLogin: on });
      onChange();
    });

  const saveSelectors = (event: FormEvent) => {
    event.preventDefault();
    const filled = Object.fromEntries(SELECTOR_FIELDS.map(({ key }) => [key, selectors[key].trim()]).filter(([, v]) => v)) as LoginSelectors;
    void run("selectors", async () => {
      await api.suppliers.setAutoLogin(supplier.id, { loginSelectors: Object.keys(filled).length > 0 ? filled : null });
      onChange();
      return "Page fields saved.";
    });
  };

  const test = () =>
    void run("test", async () => {
      await api.suppliers.testAutoLogin(supplier.id);
      setTestFrom({ at: supplier.lastAutoLoginAt });
      return "Test started. The result shows here in a minute.";
    });

  const resume = () =>
    void run("resume", async () => {
      await api.suppliers.resumeAutoLogin(supplier.id);
      onChange();
    });

  return (
    <section aria-labelledby="auto-login-title" className="flex max-w-xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="auto-login-title" className="text-lg font-semibold">
            Automatic login
          </h2>
          <p id="auto-login-hint" className="text-sm text-muted-foreground">
            Logs in for you before each check, using a password you save here.
          </p>
          {!granted && <p className="text-sm font-medium">Needs “Allows automatic checks” to be Yes.</p>}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            aria-label="Automatic login"
            aria-describedby="auto-login-hint"
            className="size-5 accent-primary disabled:opacity-60"
            checked={supplier.autoLogin}
            disabled={!granted || busy !== null}
            onChange={(e) => toggle(e.target.checked)}
          />
          {supplier.autoLogin ? "On" : "Off"}
        </label>
      </div>

      {paused && (
        <Notice kind="warning">
          <p>{PAUSE_WORDS[paused]}</p>
          <Button type="button" variant="outline" className="mt-2" loading={busy === "resume"} disabled={busy !== null} onClick={resume}>
            Resume
          </Button>
        </Notice>
      )}

      <form onSubmit={save} noValidate autoComplete="off" className="flex flex-col gap-4">
        <Field id="auto-account" label="Account number (optional)">
          <Input id="auto-account" autoComplete="off" autoCapitalize="none" spellCheck={false} value={account} onChange={(e) => setAccount(e.target.value)} />
        </Field>
        <Field id="auto-username" label="Username">
          <Input id="auto-username" autoComplete="off" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field id="auto-password" label="Password" hint={savedAt ? `Password saved ${formatDay(savedAt)}` : undefined}>
          <Input id="auto-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy === "save"} disabled={busy !== null}>
            Save
          </Button>
          {savedAt && (
            <Button type="button" variant="outline" loading={busy === "remove"} disabled={busy !== null} onClick={remove}>
              Remove
            </Button>
          )}
        </div>
      </form>

      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}
      {info && (
        <p role="status" className="text-sm font-medium">
          {info}
        </p>
      )}

      <div className="flex flex-col items-start gap-2">
        {supplier.lastAutoLoginAt && supplier.lastAutoLoginResult && (
          <p className="text-sm">
            Last automatic login: {formatWhen(supplier.lastAutoLoginAt)}, {RESULT_WORDS[supplier.lastAutoLoginResult]}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          loading={busy === "test"}
          disabled={busy !== null || !savedAt || testBlocked !== null}
          aria-describedby={testBlocked ? "auto-test-blocked" : undefined}
          onClick={test}
        >
          Test login now
        </Button>
        {testBlocked && (
          <p id="auto-test-blocked" className="text-sm text-muted-foreground">
            {testBlocked}
          </p>
        )}
      </div>

      <details className="rounded-lg border border-border px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">Login page fields (advanced)</summary>
        <form onSubmit={saveSelectors} noValidate className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Only fill these in if the login does not work on its own. Use CSS selectors, like #email.</p>
          {SELECTOR_FIELDS.map(({ key, label }) => (
            <Field key={key} id={`auto-sel-${key}`} label={label}>
              <Input
                id={`auto-sel-${key}`}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={selectors[key]}
                onChange={(e) => setSelectors((s) => ({ ...s, [key]: e.target.value }))}
              />
            </Field>
          ))}
          <div>
            <Button type="submit" variant="outline" loading={busy === "selectors"} disabled={busy !== null}>
              Save page fields
            </Button>
          </div>
        </form>
      </details>
    </section>
  );
}
