import { describe, expect, it } from "vitest";
import { captureFailureWords } from "./stockWords.js";

describe("captureFailureWords", () => {
  it("says plainly when the browser is busy", () => {
    expect(captureFailureWords("browser_busy")).toBe("The browser is busy with other checks. Try again in a minute.");
  });
  it("still has the old wording for a browser that did not answer", () => {
    expect(captureFailureWords("browser_unavailable")).toBe("The browser service did not answer. Try again in a minute.");
  });
});
