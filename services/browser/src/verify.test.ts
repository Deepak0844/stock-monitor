import { describe, expect, it } from "vitest";
import { withFreshState } from "./verify.js";

const ok = { result: "ok" as const, status: 200, blockedRequests: 0 };
const fresh = { cookies: [{ name: "s", value: "1" }], origins: [] };

describe("withFreshState", () => {
  it("adds the session to an ok answer", async () => expect(await withFreshState(ok, async () => fresh)).toEqual({ ...ok, state: fresh }));

  it("never reads or adds a session for any other answer", async () => {
    let read = false;
    const r = await withFreshState({ ...ok, result: "login_required" as const }, async () => ((read = true), fresh));
    expect(r).not.toHaveProperty("state");
    expect(read).toBe(false);
  });

  it("keeps an ok answer ok when the session cannot be read: refreshing is a side task", async () =>
    expect(await withFreshState(ok, async () => Promise.reject(new Error("cookie file unreadable")))).toEqual(ok));
});
