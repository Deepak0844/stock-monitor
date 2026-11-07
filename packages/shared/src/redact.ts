const SECRET_KEY = /pass(word)?|token|cookie|secret|authorization|api[-_]?key|private[-_]?key/i;
export const REDACTED = "[REDACTED]";

export function redactSecrets<T>(value: T): T {
  return walk(value, new WeakSet()) as T;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : walk(v, seen);
  }
  return out;
}
