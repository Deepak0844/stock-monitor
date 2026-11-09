import { describe, expect, it } from "vitest";
import { whyNotChecked } from "./gate.js";

const ready = { enabled: true, pausedReason: null, sessionStatus: "connected", automationPermission: "granted" } as const;

describe("whyNotChecked", () => {
  it("lets a connected, running supplier with recorded permission be checked", () => {
    expect(whyNotChecked(ready, true)).toBeNull();
  });
  it("refuses when permission is not recorded, with the plain message", () => {
    expect(whyNotChecked({ ...ready, automationPermission: "unknown" }, true)).toEqual({
      reason: "no_permission",
      message: "You have not recorded permission to check this supplier automatically. Open the supplier to record it.",
    });
    expect(whyNotChecked({ ...ready, automationPermission: "not_granted" }, true)?.reason).toBe("no_permission");
  });
  it("refuses a supplier with no saved login", () => {
    expect(whyNotChecked(ready, false)?.reason).toBe("not_connected");
    expect(whyNotChecked({ ...ready, sessionStatus: "not_connected" }, true)?.reason).toBe("not_connected");
  });
  it("tells a pause the owner made from one the app made", () => {
    expect(whyNotChecked({ ...ready, enabled: false, pausedReason: "owner" }, true)).toMatchObject({ reason: "paused", message: expect.stringContaining("paused") });
    expect(whyNotChecked({ ...ready, enabled: false, pausedReason: "session", sessionStatus: "needs_reconnect" }, true)).toMatchObject({ reason: "needs_attention" });
  });
  it("puts permission first", () => {
    expect(whyNotChecked({ ...ready, automationPermission: "unknown", enabled: false, pausedReason: "owner" }, false)?.reason).toBe("no_permission");
  });
});
