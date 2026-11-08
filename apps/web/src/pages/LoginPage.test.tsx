// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { LoginPage } from "./LoginPage.js";

afterEach(cleanup);

const setup = (onLogin = vi.fn().mockResolvedValue(undefined)) => {
  render(<LoginPage onLogin={onLogin} />);
  return { onLogin, user: userEvent.setup() };
};

describe("LoginPage", () => {
  it("shows a heading, labelled fields and a Sign in button", () => {
    setup();
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("lets browsers and password managers fill the fields", () => {
    setup();
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("explains each empty field next to it and does not call the server", async () => {
    const { onLogin, user } = setup();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter your email address.");
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("moves focus to the first field that needs attention", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("sends the trimmed email and the password", async () => {
    const { onLogin, user } = setup();
    await user.type(screen.getByLabelText("Email"), "  owner@example.com ");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onLogin).toHaveBeenCalledWith("owner@example.com", "correct horse battery");
  });

  it("shows the server's plain-English message in an alert and keeps what was typed", async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error("Email or password is incorrect."));
    const { user } = setup(onLogin);
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password!!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(screen.getByLabelText("Email")).toHaveValue("owner@example.com");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("shows progress and blocks a second click while signing in", async () => {
    let finish!: () => void;
    const onLogin = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = setup(onLogin);
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const busy = await screen.findByRole("button", { name: "Signing in…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  });

  it("can show and hide the password", async () => {
    const { user } = setup();
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field).toHaveAttribute("type", "password");
  });
});
