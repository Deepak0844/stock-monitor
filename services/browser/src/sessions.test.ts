import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessions, type LiveWindow } from "./sessions.js";

const STATE = { cookies: [{ name: "session", value: "abc" }], origins: [] };

/** A stand-in for a Chromium window that records what was done to it. */
function fakeWindow(over: Partial<LiveWindow> = {}) {
  let onClosed: () => void = () => {};
  const win = {
    closed: 0,
    storageState: vi.fn(async () => STATE),
    close: vi.fn(async () => void (win.closed += 1)),
    onClosed: (cb: () => void) => void (onClosed = cb),
    userClosesWindow: () => onClosed(),
    ...over,
  };
  return win;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("opening a login window", () => {
  it("opens a window at the address and hands back an id and when it will expire", async () => {
    const win = fakeWindow();
    const openWindow = vi.fn(async () => win);
    const sessions = createSessions({ openWindow, timeoutMs: 60_000 });
    const r = await sessions.open("https://shop.acme.example/login");
    expect(openWindow).toHaveBeenCalledWith("https://shop.acme.example/login");
    expect(r).toEqual({ ok: true, id: expect.stringMatching(/^[0-9a-f-]{36}$/), expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });

  it("refuses a second window while one is open, and says it is busy", async () => {
    const sessions = createSessions({ openWindow: async () => fakeWindow() });
    await sessions.open("https://a.example/");
    expect(await sessions.open("https://b.example/")).toEqual({ ok: false, reason: "busy" });
  });

  it("refuses a second window even while the first is still starting", async () => {
    let finish: (w: LiveWindow) => void = () => {};
    const openWindow = vi.fn(() => new Promise<LiveWindow>((resolve) => (finish = resolve)));
    const sessions = createSessions({ openWindow });
    const first = sessions.open("https://a.example/");
    expect(await sessions.open("https://b.example/")).toEqual({ ok: false, reason: "busy" });
    finish(fakeWindow());
    expect((await first).ok).toBe(true);
    expect(openWindow).toHaveBeenCalledTimes(1);
  });

  it("frees the slot when the window fails to start, so the next try can work", async () => {
    const openWindow = vi.fn().mockRejectedValueOnce(new Error("no display")).mockResolvedValue(fakeWindow());
    const sessions = createSessions({ openWindow });
    expect(await sessions.open("https://a.example/")).toEqual({ ok: false, reason: "failed" });
    expect((await sessions.open("https://a.example/")).ok).toBe(true);
  });
});

describe("finishing", () => {
  it("returns the saved session and closes the window", async () => {
    const win = fakeWindow();
    const sessions = createSessions({ openWindow: async () => win });
    const opened = await sessions.open("https://a.example/");
    if (!opened.ok) throw new Error("setup");
    expect(await sessions.finish(opened.id)).toEqual(STATE);
    expect(win.closed).toBe(1);
  });

  it("allows a new window afterwards, and a second finish finds nothing", async () => {
    const sessions = createSessions({ openWindow: async () => fakeWindow() });
    const a = await sessions.open("https://a.example/");
    if (!a.ok) throw new Error("setup");
    await sessions.finish(a.id);
    expect(await sessions.finish(a.id)).toBeNull();
    expect((await sessions.open("https://b.example/")).ok).toBe(true);
  });

  it("answers nothing for an id that is not the open one, and leaves the real one alone", async () => {
    const win = fakeWindow();
    const sessions = createSessions({ openWindow: async () => win });
    await sessions.open("https://a.example/");
    expect(await sessions.finish("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(win.closed).toBe(0);
  });

  it("closes the window even when the session cannot be read, then reports the failure", async () => {
    const win = fakeWindow({ storageState: vi.fn().mockRejectedValue(new Error("browser died")) });
    const sessions = createSessions({ openWindow: async () => win });
    const a = await sessions.open("https://a.example/");
    if (!a.ok) throw new Error("setup");
    await expect(sessions.finish(a.id)).rejects.toThrow("browser died");
    expect(win.closed).toBe(1);
    expect((await sessions.open("https://b.example/")).ok).toBe(true);
  });
});

describe("cancelling, timing out and closing", () => {
  it("cancel closes the window and saves nothing", async () => {
    const win = fakeWindow();
    const sessions = createSessions({ openWindow: async () => win });
    const a = await sessions.open("https://a.example/");
    if (!a.ok) throw new Error("setup");
    expect(await sessions.cancel(a.id)).toBe(true);
    expect(win.closed).toBe(1);
    expect(win.storageState).not.toHaveBeenCalled();
    expect(await sessions.cancel(a.id)).toBe(false);
  });

  it("closes the window by itself when the time runs out, and keeps nothing", async () => {
    const win = fakeWindow();
    const sessions = createSessions({ openWindow: async () => win, timeoutMs: 15 * 60_000 });
    const a = await sessions.open("https://a.example/");
    if (!a.ok) throw new Error("setup");
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
    expect(win.closed).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(win.closed).toBe(1);
    expect(win.storageState).not.toHaveBeenCalled();
    expect(await sessions.finish(a.id)).toBeNull();
    expect((await sessions.open("https://b.example/")).ok).toBe(true);
  });

  it("does not close a later window when an earlier window's timer fires", async () => {
    const windows = [fakeWindow(), fakeWindow()];
    const sessions = createSessions({ openWindow: async () => windows.shift() as LiveWindow, timeoutMs: 1000 });
    const a = await sessions.open("https://a.example/");
    if (!a.ok) throw new Error("setup");
    await sessions.cancel(a.id);
    await vi.advanceTimersByTimeAsync(500);
    const second = windows[0] as ReturnType<typeof fakeWindow>;
    await sessions.open("https://b.example/");
    await vi.advanceTimersByTimeAsync(600); // the first timer's moment has passed
    expect(second.closed).toBe(0);
  });

  it("frees the slot when the owner closes the Chromium window themselves", async () => {
    const win = fakeWindow();
    const sessions = createSessions({ openWindow: async () => win });
    const a = await sessions.open("https://a.example/");
    if (!a.ok) throw new Error("setup");
    win.userClosesWindow();
    await vi.advanceTimersByTimeAsync(0);
    expect(await sessions.finish(a.id)).toBeNull();
    expect((await sessions.open("https://b.example/")).ok).toBe(true);
  });

  it("closeAll shuts the open window, for when the service stops", async () => {
    const win = fakeWindow();
    const sessions = createSessions({ openWindow: async () => win });
    await sessions.open("https://a.example/");
    await sessions.closeAll();
    expect(win.closed).toBe(1);
    await sessions.closeAll();
    expect(win.closed).toBe(1);
  });
});
