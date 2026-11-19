import { describe, expect, it } from "vitest";
import { isAvoided, looksLikeLogin } from "./login-guess.js";

describe("looksLikeLogin", () => {
  it.each(["login to your account", "Sign in securely", "  LOG   IN ", "Continue", "Access my account", "Enter portal"])("%s reads like a login control", (text) => {
    expect(looksLikeLogin(text)).toBe(true);
  });
  it.each(["Forgot password?", "Register", "Sign up to our newsletter", "Continue with Google", "Log out", "Search", "Subscribe", "Google"])("%s does not", (text) => {
    expect(looksLikeLogin(text)).toBe(false);
  });
});

describe("isAvoided", () => {
  it.each(["Create account", "Show password", "Back", "Sign out", "Continue with Apple"])("%s is avoided", (text) => {
    expect(isAvoided(text)).toBe(true);
  });
  it("Sign in is not", () => {
    expect(isAvoided("Sign in")).toBe(false);
  });
});
