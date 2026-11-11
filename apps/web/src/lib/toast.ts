// A small message that appears for a moment: "Label saved." It pushes nothing down. Problems the owner must act on are never
// shown here. They stay on the page, and in the bell.
export type ToastItem = { id: number; text: string };

const VISIBLE_MS = 4000;
let items: ToastItem[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const subscribeToasts = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const getToasts = () => items;

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(text: string): void {
  const id = next++;
  items = [...items, { id, text }];
  emit();
  setTimeout(() => dismissToast(id), VISIBLE_MS);
}

/** For tests. */
export function clearToasts(): void {
  items = [];
  emit();
}
