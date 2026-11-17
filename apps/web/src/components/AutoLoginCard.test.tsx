// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { aSupplier, fakeApi } from "../test/fake-api.js";
import { AutoLoginCard } from "./AutoLoginCard.js";

afterEach(cleanup);
const granted = { automationPermission: "granted" as const };
const setup = (over: Parameters<typeof aSupplier>[0] = granted, apiOver: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi(apiOver);
  const onChange = vi.fn();
  render(<AutoLoginCard api={api} supplier={aSupplier(over)} onChange={onChange} />);
  return { api, onChange, user: userEvent.setup() };
};

describe("Automatic login card", () => {
  it("saves the login, then empties the fields", async () => {
    const { api, onChange, user } = setup();
    await user.type(screen.getByLabelText("Account number (optional)"), "A1");
    await user.type(screen.getByLabelText("Username"), "me@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.suppliers.saveCredentials).toHaveBeenCalledWith(aSupplier().id, { username: "me@example.com", password: "hunter2", account: "A1" });
    expect(await screen.findByText(/Password saved/)).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Account number (optional)")).toHaveValue("");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows the saved date from the supplier and starts with empty fields", () => {
    setup({ ...granted, credentialsSavedAt: "2026-11-17T06:58:00.000Z" });
    expect(screen.getByText(/Password saved 17 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("disables the switch and says why when permission is not granted", () => {
    setup({ automationPermission: "unknown" });
    expect(screen.getByRole("switch", { name: "Automatic login" })).toBeDisabled();
    expect(screen.getByText("Needs “Allows automatic checks” to be Yes.")).toBeInTheDocument();
  });

  it("turns the switch on", async () => {
    const { api, user } = setup({ ...granted, credentialsSavedAt: "2026-11-17T06:58:00.000Z" });
    await user.click(screen.getByRole("switch", { name: "Automatic login" }));
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { autoLogin: true });
  });

  it("shows the refusal when the switch cannot be turned on", async () => {
    const setAutoLogin = vi.fn().mockRejectedValue(new Error("Save a username and password first."));
    const { user } = setup(granted, { suppliers: { setAutoLogin } });
    await user.click(screen.getByRole("switch", { name: "Automatic login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save a username and password first.");
  });

  it("says why it is paused and Resume calls the route", async () => {
    const { api, onChange, user } = setup({ ...granted, autoLoginPausedReason: "wrong_password" });
    expect(screen.getByText("The supplier refused the saved password")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(api.suppliers.resumeAutoLogin).toHaveBeenCalledWith(aSupplier().id);
    expect(onChange).toHaveBeenCalled();
  });

  it("explains a pause after two failures and a locked account", () => {
    setup({ ...granted, autoLoginPausedReason: "too_many_failures" });
    expect(screen.getByText("Two automatic logins failed in a row")).toBeInTheDocument();
    cleanup();
    setup({ ...granted, autoLoginPausedReason: "account_locked" });
    expect(screen.getByText("The supplier says the account is locked")).toBeInTheDocument();
  });

  it("shows the last result in plain words", () => {
    setup({ ...granted, lastAutoLoginAt: "2026-11-17T06:58:00.000Z", lastAutoLoginResult: "code_required" });
    expect(screen.getByText(/Last automatic login: .*, asked for a code/)).toBeInTheDocument();
  });

  it("keeps the login page fields collapsed, and saves only the filled ones", async () => {
    const { api, user } = setup();
    const summary = screen.getByText("Login page fields (advanced)");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await user.click(summary);
    await user.type(screen.getByLabelText("Username field"), "#email");
    await user.type(screen.getByLabelText("Login button"), "button.go");
    await user.click(screen.getByRole("button", { name: "Save page fields" }));
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { loginSelectors: { username: "#email", submit: "button.go" } });
  });

  it("clears the login page fields with null when all are empty", async () => {
    const { api, user } = setup({ ...granted, loginSelectors: { username: "#email" } });
    await user.click(screen.getByText("Login page fields (advanced)"));
    await user.clear(screen.getByLabelText("Username field"));
    await user.click(screen.getByRole("button", { name: "Save page fields" }));
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { loginSelectors: null });
  });

  it("starts a test login", async () => {
    const { api, user } = setup({ ...granted, credentialsSavedAt: "2026-11-17T06:58:00.000Z" });
    await user.click(screen.getByRole("button", { name: "Test login now" }));
    expect(api.suppliers.testAutoLogin).toHaveBeenCalledWith(aSupplier().id);
    expect(await screen.findByText("Test started. The result shows here in a minute.")).toBeInTheDocument();
  });

  it("removes the saved login", async () => {
    const { api, onChange, user } = setup({ ...granted, credentialsSavedAt: "2026-11-17T06:58:00.000Z" });
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(api.suppliers.removeCredentials).toHaveBeenCalledWith(aSupplier().id);
    expect(onChange).toHaveBeenCalled();
  });
});
