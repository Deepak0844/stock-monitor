import { useSyncExternalStore } from "react";

// Whether the screen is at least 1024px wide (Tailwind's `lg`). The frame swaps the sidebar for tabs at the bottom below it.
// Where matchMedia is missing (tests, very old browsers) the wide layout is used.
const QUERY = "(min-width: 64rem)";
const media = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null);

const subscribe = (onChange: () => void) => {
  const m = media();
  m?.addEventListener?.("change", onChange);
  return () => m?.removeEventListener?.("change", onChange);
};

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? true);
}
