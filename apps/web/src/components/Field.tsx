import type { ReactNode } from "react";

type Props = {
  /** The id of the control inside. The error gets the id `${id}-error` for aria-describedby. */
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
};

/** A form field: a visible label, the control, a hint, and the error under the control it belongs to. */
export function Field({ id, label, hint, error, children }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A read-only value with a label, for a field that cannot be changed. */
export function ReadOnlyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-sm">{children}</p>
    </div>
  );
}
