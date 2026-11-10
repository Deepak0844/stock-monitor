import { describe, expect, it } from "vitest";
import { aRun } from "../test/fake-api.js";
import { intervalWords, runSummary, whenWords } from "./scheduleWords.js";

describe("intervalWords", () => {
  it.each([[null, "Automatic checks off"], [60, "Every hour"], [180, "Every 3 hours"], [360, "Every 6 hours"], [720, "Every 12 hours"], [1440, "Every day"]])("%s is %s", (minutes, words) => {
    expect(intervalWords(minutes)).toBe(words);
  });
});

describe("runSummary", () => {
  it("says how far a running run is", () => expect(runSummary(aRun({ outcome: "running", endedAt: null, linksDone: 12, linksTotal: 40 }))).toBe("Checking 12 of 40 links"));
  it("says one link in the singular", () => expect(runSummary(aRun({ outcome: "running", endedAt: null, linksDone: 0, linksTotal: 1 }))).toBe("Checking 0 of 1 link"));
  it("sums up a finished run, leaving out cannot tell when there were none", () => {
    expect(runSummary(aRun())).toBe("Checked 40 links, 3 cannot tell");
    expect(runSummary(aRun({ cannotTell: 0, linksDone: 1, linksTotal: 1 }))).toBe("Checked 1 link");
  });
  it.each([
    ["login_required", "The supplier asked you to log in again."],
    ["captcha", "The supplier showed a puzzle (CAPTCHA)."],
    ["blocked", "The supplier refused the automatic check."],
    ["unreachable", "The supplier could not be reached."],
    ["supplier_not_ready", "The supplier was paused or no longer allowed."],
    ["restarted", "The app restarted."],
    ["expired", "The run took too long and was stopped."],
  ])("explains a run stopped for %s in plain words", (stopReason, sentence) => {
    expect(runSummary(aRun({ outcome: "stopped", stopReason, linksDone: 2, linksTotal: 40 }))).toBe(`Stopped after 2 of 40 links. ${sentence}`);
  });
  it("says a failed run failed, in plain words", () => {
    expect(runSummary(aRun({ outcome: "failed", stopReason: "not_queued", linksDone: 0 }))).toBe("The check could not be started.");
    expect(runSummary(aRun({ outcome: "failed", stopReason: "error", linksDone: 0 }))).toBe("The check failed. It will be tried again later.");
  });
});

describe("whenWords", () => {
  it("is empty when there is no time", () => expect(whenWords(null)).toBe(""));
});
