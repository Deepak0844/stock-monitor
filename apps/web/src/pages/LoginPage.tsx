import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Field } from "../components/Field.js";
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
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="flex flex-col justify-between gap-10 bg-sidebar p-8 text-sidebar-foreground lg:p-12">
        <Logo className="text-white" />
        <div className="max-w-md">
          <p className="text-2xl font-bold leading-snug text-white lg:text-3xl">Know what your suppliers have, before your customers order.</p>
          <ul className="mt-6 flex flex-col gap-3 text-base">
            {["Checks your suppliers' stock for you.", "You approve every change.", "Nothing reaches Shopify without your OK."].map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-accent" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="grid place-items-center p-6 lg:p-12">
        <form className="flex w-full max-w-sm flex-col gap-5" onSubmit={submit} noValidate>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Use the owner account to review supplier stock and approve changes.</p>
          </div>

          <Field id="email" label="Email" error={errors.email}>
            <Input
              id="email"
              ref={emailRef}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? "true" : undefined}
              aria-describedby={errors.email ? "email-error" : undefined}
            />
          </Field>

          <Field id="password" label="Password" error={errors.password}>
            <div className="relative">
              <Input
                id="password"
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="pr-12"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={errors.password ? "true" : undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
              />
              <button
                type="button"
                className="absolute right-0 top-0 grid size-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </Field>

          {formError && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {formError}
            </p>
          )}

          <Button type="submit" loading={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </main>
    </div>
  );
}
