import { randomUUID } from "node:crypto";
import type { SessionState } from "@stock-monitor/supplier-session";

/** One open Chromium window the owner is using. */
export type LiveWindow = {
  /** The cookies and local storage as they are now. */
  storageState(): Promise<SessionState>;
  /** Closes Chromium and removes its profile. Safe to call twice. */
  close(): Promise<void>;
  /** Calls back when the window goes away without being asked, for example the owner closes it. */
  onClosed(callback: () => void): void;
};
export type OpenWindow = (url: string) => Promise<LiveWindow>;

export type OpenResult = { ok: true; id: string; expiresAt: string } | { ok: false; reason: "busy" | "failed" };

type Slot = { id: string; window: LiveWindow | null; timer: NodeJS.Timeout; closing: Promise<void> | null };

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/**
 * Keeps track of the one login window that may be open. A window ends in exactly one way: the owner
 * finishes it (the session is returned), the owner cancels it, the time runs out, or Chromium goes away.
 * Whatever the way, Chromium is closed and the slot is free again.
 */
export function createSessions({ openWindow, timeoutMs = DEFAULT_TIMEOUT_MS }: { openWindow: OpenWindow; timeoutMs?: number }) {
  let current: Slot | null = null;

  /** Closes the slot's window, and frees the slot only once Chromium has really gone. */
  const end = (slot: Slot): Promise<void> => {
    slot.closing ??= (async () => {
      clearTimeout(slot.timer);
      try {
        await slot.window?.close();
      } finally {
        if (current === slot) current = null;
      }
    })();
    return slot.closing;
  };

  return {
    async open(url: string): Promise<OpenResult> {
      if (current) return { ok: false, reason: "busy" };
      // The slot is taken before Chromium starts, so two requests at once cannot both open a window.
      const slot: Slot = { id: randomUUID(), window: null, closing: null, timer: setTimeout(() => void end(slot).catch(() => {}), timeoutMs) };
      slot.timer.unref();
      const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
      current = slot;
      try {
        slot.window = await openWindow(url);
      } catch {
        await end(slot).catch(() => {});
        return { ok: false, reason: "failed" };
      }
      if (slot.closing) {
        await slot.window.close().catch(() => {}); // the time ran out while Chromium was starting
        return { ok: false, reason: "failed" };
      }
      slot.window.onClosed(() => void end(slot).catch(() => {}));
      return { ok: true, id: slot.id, expiresAt };
    },

    /** The saved session, and the window is closed. null when there is no such open window. */
    async finish(id: string): Promise<SessionState | null> {
      const slot = current;
      if (!slot || slot.id !== id || !slot.window || slot.closing) return null;
      try {
        return await slot.window.storageState();
      } finally {
        await end(slot).catch(() => {});
      }
    },

    async cancel(id: string): Promise<boolean> {
      const slot = current;
      if (!slot || slot.id !== id || slot.closing) return false;
      await end(slot);
      return true;
    },

    async closeAll(): Promise<void> {
      if (current) await end(current).catch(() => {});
    },
  };
}
