import { describe, expect, it } from "vitest";
import { decideAfterSubmit, type AfterSubmitFacts } from "./login.js";

const none: AfterSubmitFacts = {
  challengeVisible: false,
  codeFieldVisible: false,
  secondCheckText: false,
  lockedText: false,
  passwordFieldVisible: false,
  onLoginPage: false,
  pageClass: "ok",
};

describe("decideAfterSubmit", () => {
  it("a visible puzzle is a captcha", () => {
    expect(decideAfterSubmit({ ...none, challengeVisible: true })).toBe("captcha");
  });
  it("a puzzle wins over a code field", () => {
    expect(decideAfterSubmit({ ...none, challengeVisible: true, codeFieldVisible: true })).toBe("captcha");
  });
  it("a code field asks for a code", () => {
    expect(decideAfterSubmit({ ...none, codeFieldVisible: true, lockedText: true })).toBe("code_required");
  });
  it("approve or check-your-email text asks for a code", () => {
    expect(decideAfterSubmit({ ...none, secondCheckText: true, lockedText: true })).toBe("code_required");
  });
  it("locked text is a locked account, before a visible password field", () => {
    expect(decideAfterSubmit({ ...none, lockedText: true, passwordFieldVisible: true, onLoginPage: true })).toBe("account_locked");
  });
  it("a password field still on the login page is a wrong password", () => {
    expect(decideAfterSubmit({ ...none, passwordFieldVisible: true, onLoginPage: true })).toBe("wrong_password");
  });
  it("a password field on another page goes to the classifier", () => {
    expect(decideAfterSubmit({ ...none, passwordFieldVisible: true, onLoginPage: false, pageClass: "unknown" })).toBe("unknown");
  });
  it("the classifier's login_required is a wrong password", () => {
    expect(decideAfterSubmit({ ...none, pageClass: "login_required" })).toBe("wrong_password");
  });
  it("the classifier's other answers pass through", () => {
    for (const c of ["ok", "captcha", "blocked", "unreachable", "unknown"] as const) expect(decideAfterSubmit({ ...none, pageClass: c })).toBe(c);
  });
});
