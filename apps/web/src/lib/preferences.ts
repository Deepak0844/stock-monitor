import { useSyncExternalStore } from "react";

// Display choices the owner makes once and keeps on this device: how tightly tables are packed, and whether the sidebar shows
// whether checks are running. Storage can be blocked (a private window, strict settings), so every read and write is guarded
// and the app falls back to the defaults.
export type Preferences = { rows: "comfortable" | "compact"; checkStatus: boolean };

const KEY = "stock-monitor:prefs";
const DEFAULTS: Preferences = { rows: "comfortable", checkStatus: true };
const VALID: { [K in keyof Preferences]: (v: unknown) => v is Preferences[K] } = {
  rows: (v): v is Preferences["rows"] => v === "comfortable" || v === "compact",
  checkStatus: (v): v is boolean => typeof v === "boolean",
};

let current: Preferences | null = null;
const listeners = new Set<() => void>();

function load(): Preferences {
  const out = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    for (const key of Object.keys(DEFAULTS) as (keyof Preferences)[]) {
      const value = saved[key];
      if (VALID[key](value)) (out as Record<string, unknown>)[key] = value;
    }
  } catch {
    // Blocked or broken storage: keep the defaults.
  }
  return out;
}

const all = () => (current ??= load());

export function getPreference<K extends keyof Preferences>(key: K): Preferences[K] {
  return all()[key];
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  current = { ...all(), [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Kept for this visit only.
  }
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function usePreference<K extends keyof Preferences>(key: K): [Preferences[K], (value: Preferences[K]) => void] {
  const value = useSyncExternalStore(subscribe, () => getPreference(key));
  return [value, (next) => setPreference(key, next)];
}

/** For tests: forget the in-memory copy so the next read comes from storage again. */
export function resetPreferencesForTests(): void {
  current = null;
}
