import { toast } from "./toast.js";

// Reject and delete wait a few seconds before they are sent, so Undo really undoes. The page hides the row at once. If the owner
// leaves the page or a phone hides it during the wait, whatever is waiting is sent straight away (kept alive by the browser), so it
// is never lost. Undo is no longer possible after that.
export const UNDO_MS = 5000;

type Waiting = { timer: ReturnType<typeof setTimeout>; send: (keepalive: boolean) => void };
const waiting = new Map<number, Waiting>();
let next = 1;
let listening = false;

const flush = () => waiting.forEach((w) => w.send(true));

export type DeferredAction = {
  /** What the message says, for example "Link deleted." */
  text: string;
  /** Sends the request. `keepalive` is true when the page is closing. */
  commit(keepalive: boolean): Promise<void>;
  /** Puts the row back: Undo was pressed. */
  onUndo(): void;
  /** Puts the row back: the request failed. The message has already been shown. */
  onFailed(message: string): void;
};

export function deferred({ text, commit, onUndo, onFailed }: DeferredAction): void {
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    // A phone switching apps often only hides the page, and may then close it without a pagehide.
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
    listening = true;
  }
  const id = next++;
  const send = (keepalive: boolean) => {
    const entry = waiting.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    waiting.delete(id);
    commit(keepalive).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      onFailed(message);
      toast(message, { kind: "error" });
    });
  };
  waiting.set(id, { timer: setTimeout(() => send(false), UNDO_MS), send });
  toast(text, {
    durationMs: UNDO_MS,
    action: {
      label: "Undo",
      run: () => {
        const entry = waiting.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        waiting.delete(id);
        onUndo();
      },
    },
  });
}
