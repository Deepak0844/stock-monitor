// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { aNotification, fakeApi } from "../test/fake-api.js";
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
    const { result } = renderHook(() => useNotifications(api, true));
    await waitFor(() => expect(result.current.unread).toBe(1));

    act(() => result.current.reload()); // a poll starts and is slow
    await act(async () => void (await result.current.markRead("n1")));
    expect(result.current.unread).toBe(0);

    await act(async () => answerOld([unread])); // the old answer still says unread
    expect(result.current.unread).toBe(0);
  });
});
