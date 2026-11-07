import { describe, expect, it } from "vitest";
import { APP_NAME } from "./app-info.js";

describe("app info", () => {
  it("names the application stock-monitor", () => {
    expect(APP_NAME).toBe("stock-monitor");
  });
});
