import { useSyncExternalStore } from "react";

// The owner's theme: follow the device, or always light, or always dark. Saved on this device. Storage can be blocked, so every
// read and write is guarded and the device's setting is used.
export type Theme = "system" | "light" | "dark";

const KEY = "theme";
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export const systemDark = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Puts the theme on the page. "system" leaves it to the device (the stylesheet follows prefers-color-scheme). */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    if (theme === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, theme);
  } catch {
    // The choice still applies for this visit.
  }
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useTheme(): [Theme, (theme: Theme) => void] {
  return [useSyncExternalStore(subscribe, getTheme), setTheme];
}

// Applied before the first paint of the app, so a saved choice does not flash the other theme.
if (typeof window !== "undefined") {
  const saved = getTheme();
  if (saved !== "system") applyTheme(saved);
}
