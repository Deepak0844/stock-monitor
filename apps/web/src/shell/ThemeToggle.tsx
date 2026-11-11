import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button.js";

const KEY = "theme";

const stored = (): "light" | "dark" | null => {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};
const systemDark = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
}

// Applied before the first paint of the app, so a saved choice does not flash the other theme.
const saved = typeof window === "undefined" ? null : stored();
if (saved) apply(saved);

export function ThemeToggle() {
  const [dark, setDark] = useState(() => (saved ?? (systemDark() ? "dark" : "light")) === "dark");
  const toggle = () => {
    const next = dark ? "light" : "dark";
    apply(next);
    setDark(!dark);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // The choice still applies for this visit.
    }
  };
  return (
    <Button variant="outline" size="icon" aria-label="Dark theme" aria-pressed={dark} onClick={toggle}>
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
