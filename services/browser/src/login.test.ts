import { describe, expect, it } from "vitest";
import { decideAfterSubmit, type AfterSubmitFacts } from "./login.js";

const none: AfterSubmitFacts = {
  challengeVisible: false,
  captchaFrameText: false,
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
  it("a captcha frame that loaded a challenge, on a page that is not ok, is a captcha, not a code", () => {
    expect(decideAfterSubmit({ ...none, captchaFrameText: true, pageClass: "login_required", passwordFieldVisible: true, onLoginPage: true })).toBe("captcha");
  });
  it("a captcha frame's text on a logged-in page changes nothing", () => {
    expect(decideAfterSubmit({ ...none, captchaFrameText: true })).toBe("ok");
  });
  it("a puzzle wins over a code field", () => {
    expect(decideAfterSubmit({ ...none, challengeVisible: true, codeFieldVisible: true })).toBe("captcha");
  });
  it("a code field asks for a code", () => {
    expect(decideAfterSubmit({ ...none, codeFieldVisible: true, lockedText: true, pageClass: "unknown" })).toBe("code_required");
  });
  it("approve or check-your-email text asks for a code", () => {
    expect(decideAfterSubmit({ ...none, secondCheckText: true, lockedText: true, pageClass: "unknown" })).toBe("code_required");
  });
  it("locked text is a locked account, before a visible password field", () => {
    expect(decideAfterSubmit({ ...none, lockedText: true, passwordFieldVisible: true, onLoginPage: true, pageClass: "login_required" })).toBe("account_locked");
  });
  it("a password field still on the login page is a wrong password", () => {
    expect(decideAfterSubmit({ ...none, passwordFieldVisible: true, onLoginPage: true })).toBe("wrong_password");
  });
  it("a password field on another page goes to the classifier", () => {
    expect(decideAfterSubmit({ ...none, passwordFieldVisible: true, onLoginPage: false, pageClass: "unknown" })).toBe("unknown");
  });
  it("login_required with no visible password field is unknown, not a wrong password", () => {
    expect(decideAfterSubmit({ ...none, pageClass: "login_required", onLoginPage: true })).toBe("unknown");
  });
  it("an ok page that says verify is ok", () => {
    expect(decideAfterSubmit({ ...none, secondCheckText: true, pageClass: "ok" })).toBe("ok");
  });
  it("a non-ok page that says approve on your phone asks for a code", () => {
    expect(decideAfterSubmit({ ...none, secondCheckText: true, pageClass: "unknown" })).toBe("code_required");
  });
  it("an ok page that says account locked is ok", () => {
    expect(decideAfterSubmit({ ...none, lockedText: true, pageClass: "ok" })).toBe("ok");
  });
  it("an ok page with a code box (a postcode, a promo code) is ok", () => {
    expect(decideAfterSubmit({ ...none, codeFieldVisible: true, pageClass: "ok" })).toBe("ok");
  });
  it("a code box on a page that is not ok asks for a code", () => {
    expect(decideAfterSubmit({ ...none, codeFieldVisible: true, pageClass: "unknown" })).toBe("code_required");
  });
  it("the classifier's other answers pass through", () => {
    for (const c of ["ok", "captcha", "blocked", "unreachable", "unknown"] as const) expect(decideAfterSubmit({ ...none, pageClass: c })).toBe(c);
  });
});
