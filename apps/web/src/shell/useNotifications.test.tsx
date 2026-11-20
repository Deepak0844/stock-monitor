// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { aNotification, fakeApi } from "../test/fake-api.js";
import { storeWrapper } from "../test/renderWithStore.js";
import { useNotifications } from "./useNotifications.js";

afterEach(cleanup);

describe("useNotifications", () => {
  it("ignores a list that was asked for before something was marked read, so the count does not jump back", async () => {
    let answerOld!: (rows: ReturnType<typeof aNotification>[]) => void;
    const unread = aNotification({ id: "n1", readAt: null });
    const list = vi
      .fn()
      .mockResolvedValueOnce([unread])
      .mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValue([{ ...unread, readAt: "2026-11-11T10:00:00.000Z" }]);
    const api = fakeApi({ notifications: { list } });
    const { result } = renderHook(() => useNotifications(true), { wrapper: storeWrapper(api) });
    await waitFor(() => expect(result.current.unread).toBe(1));

    act(() => result.current.reload()); // a poll starts and is slow
    await act(async () => void (await result.current.markRead("n1")));
    expect(result.current.unread).toBe(0);

    await act(async () => answerOld([unread])); // the old answer still says unread
    expect(result.current.unread).toBe(0);
  });

  it("asks the server once when the bell and the Dashboard both show notifications", async () => {
    const list = vi.fn().mockResolvedValue([aNotification({ id: "n1", readAt: null })]);
    const wrapper = storeWrapper(fakeApi({ notifications: { list } }));
    const { result } = renderHook(() => [useNotifications(true), useNotifications(true)] as const, { wrapper });
    await waitFor(() => expect(result.current[1].unread).toBe(1));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("never asks while nobody is signed in", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useNotifications(false), { wrapper: storeWrapper(fakeApi({ notifications: { list } })) });
    expect(result.current.loading).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });

  it("reads the list again when saving a read mark fails, so it shows what is true", async () => {
    const unread = aNotification({ id: "n1", readAt: null });
    const list = vi.fn().mockResolvedValue([unread]);
    const markRead = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useNotifications(true), { wrapper: storeWrapper(fakeApi({ notifications: { list, markRead } })) });
    await waitFor(() => expect(result.current.unread).toBe(1));
    await act(async () => void (await result.current.markRead("n1")));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.unread).toBe(1));
  });
});
