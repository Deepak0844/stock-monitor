import { useRef, useState, type FormEvent } from "react";
import { Logo } from "../components/Logo.js";
import { IconEye, IconEyeOff } from "../components/icons.js";

type Props = { onLogin: (email: string, password: string) => Promise<void> };
type FieldErrors = { email?: string; password?: string };

export function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    const next: FieldErrors = {};
    if (!trimmed) next.email = "Enter your email address.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    setFormError(null);
    if (next.email) return emailRef.current?.focus();
    if (next.password) return passwordRef.current?.focus();

    setPending(true);
    try {
      await onLogin(trimmed, password);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth">
      <aside className="auth-brand">
        <Logo />
        <div className="auth-pitch">
          <p className="auth-tagline">Know what your suppliers have, before your customers order.</p>
          <ul className="auth-points">
            <li>Checks your suppliers' stock for you.</li>
            <li>You approve every change.</li>
            <li>Nothing reaches Shopify without your OK.</li>
          </ul>
        </div>
      </aside>

      <main className="auth-side">
        <form className="auth-card" onSubmit={submit} noValidate>
          <h1>Sign in</h1>
          <p className="muted">Use the owner account to review supplier stock and approve changes.</p>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              ref={emailRef}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? "true" : undefined}
              aria-describedby={errors.email ? "email-error" : undefined}
            />
            {errors.email && (
              <p id="email-error" className="field-error">
                {errors.email}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-wrap">
              <input
                id="password"
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={errors.password ? "true" : undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
            {errors.password && (
              <p id="password-error" className="field-error">
                {errors.password}
              </p>
            )}
          </div>

          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}

          <button type="submit" className="button primary" disabled={pending} aria-busy={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
