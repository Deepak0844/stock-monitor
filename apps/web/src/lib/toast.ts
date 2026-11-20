// A small message that appears for a moment: "Label saved." It pushes nothing down. Errors stay until closed. A message can carry
// one action, such as Undo. Problems the owner must act on later still stay on the page, and in the bell.
export type ToastKind = "success" | "error";
export type ToastAction = { label: string; run(): void };
export type ToastItem = { id: number; text: string; kind: ToastKind; action?: ToastAction };
export type ToastOptions = { kind?: ToastKind; action?: ToastAction; durationMs?: number };

const VISIBLE_MS = 4000;
let items: ToastItem[] = [];
let next = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const subscribeToasts = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const getToasts = () => items;

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Shows a message and returns its id. Errors stay until closed; everything else leaves after a few seconds, or after `durationMs`. */
export function toast(text: string, opts: ToastOptions = {}): number {
  const id = next++;
  const kind = opts.kind ?? "success";
  items = [...items, { id, text, kind, action: opts.action }];
  emit();
  if (kind !== "error") timers.set(id, setTimeout(() => dismissToast(id), opts.durationMs ?? VISIBLE_MS));
  return id;
}

/** Presses a message's action: runs it once and closes the message. */
export function runToastAction(id: number): void {
  const item = items.find((t) => t.id === id);
  dismissToast(id);
  item?.action?.run();
}

/** For tests. */
export function clearToasts(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  items = [];
  emit();
}
