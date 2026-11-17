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

  it("says a login that did not finish without claiming one was tried", () => {
    setup({ ...granted, lastAutoLoginAt: "2026-11-17T06:58:00.000Z", lastAutoLoginResult: "unknown" });
    expect(screen.getByText(/login did not finish \(nothing was sent if a box would not take the text\)/)).toBeInTheDocument();
    expect(screen.queryByText(/not sure it worked/)).not.toBeInTheDocument();
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
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { loginSelectors: { username: "#email", submit: "button.go" }, loggedInMarker: null });
  });

  it("clears the login page fields with null when all are empty", async () => {
    const { api, user } = setup({ ...granted, loginSelectors: { username: "#email" } });
    await user.click(screen.getByText("Login page fields (advanced)"));
    await user.clear(screen.getByLabelText("Username field"));
    await user.click(screen.getByRole("button", { name: "Save page fields" }));
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { loginSelectors: null, loggedInMarker: null });
  });

  it("saves the logged-in marker with the page fields, trimmed, and shows its hint", async () => {
    const { api, user } = setup();
    await user.click(screen.getByText("Login page fields (advanced)"));
    expect(screen.getByText("Text you see only when logged in, like 'Log out' or your account name")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Only shows when logged in"), "  Log out ");
    await user.click(screen.getByRole("button", { name: "Save page fields" }));
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { loginSelectors: null, loggedInMarker: "Log out" });
  });

  it("shows a saved logged-in marker, and clears it with null when emptied", async () => {
    const { api, user } = setup({ ...granted, loggedInMarker: "Log out" });
    await user.click(screen.getByText("Login page fields (advanced)"));
    const field = screen.getByLabelText("Only shows when logged in");
    expect(field).toHaveValue("Log out");
    expect(field).toHaveAttribute("maxLength", "200");
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Save page fields" }));
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { loginSelectors: null, loggedInMarker: null });
  });

  it("starts a test login", async () => {
    const { api, user } = setup({ ...granted, autoLogin: true, credentialsSavedAt: "2026-11-17T06:58:00.000Z" });
    await user.click(screen.getByRole("button", { name: "Test login now" }));
    expect(api.suppliers.testAutoLogin).toHaveBeenCalledWith(aSupplier().id);
    expect(await screen.findByText("Test started. The result shows here in a minute.")).toBeInTheDocument();
  });

  it("keeps Test login now off, and says why, while automatic login is off", () => {
    setup({ ...granted, autoLogin: false, credentialsSavedAt: "2026-11-17T06:58:00.000Z" });
    expect(screen.getByRole("button", { name: "Test login now" })).toBeDisabled();
    expect(screen.getByText("Turn on automatic login first.")).toBeInTheDocument();
  });

  it("keeps Test login now off, and says why, while automatic login is paused", () => {
    setup({ ...granted, autoLogin: true, autoLoginPausedReason: "too_many_failures", credentialsSavedAt: "2026-11-17T06:58:00.000Z" });
    expect(screen.getByRole("button", { name: "Test login now" })).toBeDisabled();
    expect(screen.getByText("Press Resume first.")).toBeInTheDocument();
  });

  describe("removing the saved login", () => {
    const withLogin = () => setup({ ...granted, credentialsSavedAt: "2026-11-17T06:58:00.000Z" });

    it("asks first, and removes nothing until it is confirmed", async () => {
      const { api, onChange, user } = withLogin();
      await user.click(screen.getByRole("button", { name: "Remove" }));
      expect(screen.getByRole("heading", { name: "Remove the saved login?" })).toBeInTheDocument();
      expect(screen.getByText(/switches automatic login off/i)).toBeInTheDocument();
      expect(api.suppliers.removeCredentials).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps the saved login when the question is cancelled", async () => {
      const { api, onChange, user } = withLogin();
      await user.click(screen.getByRole("button", { name: "Remove" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("heading", { name: "Remove the saved login?" })).not.toBeInTheDocument();
      expect(api.suppliers.removeCredentials).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("removes the saved login once it is confirmed", async () => {
      const { api, onChange, user } = withLogin();
      await user.click(screen.getByRole("button", { name: "Remove" }));
      await user.click(screen.getByRole("button", { name: "Remove login" }));
      expect(api.suppliers.removeCredentials).toHaveBeenCalledWith(aSupplier().id);
      expect(onChange).toHaveBeenCalled();
    });

    it("keeps the question open, with the reason, when the removal fails", async () => {
      const { user } = setup({ ...granted, credentialsSavedAt: "2026-11-17T06:58:00.000Z" }, { suppliers: { removeCredentials: vi.fn().mockRejectedValue(new Error("The server said no.")) } });
      await user.click(screen.getByRole("button", { name: "Remove" }));
      await user.click(screen.getByRole("button", { name: "Remove login" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("The server said no.");
      expect(screen.getByRole("heading", { name: "Remove the saved login?" })).toBeInTheDocument();
    });
  });
});

describe("Automatic login card: waiting for a test result", () => {
  const saved = { ...granted, autoLogin: true, credentialsSavedAt: "2026-11-17T06:58:00.000Z", lastAutoLoginAt: "2026-11-17T06:00:00.000Z" as string | null };
  const start = async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = fakeApi();
    const onChange = vi.fn();
    const view = render(<AutoLoginCard api={api} supplier={aSupplier(saved)} onChange={onChange} />);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Test login now" }));
    await screen.findByText("Test started. The result shows here in a minute.");
    onChange.mockClear();
    return { api, onChange, view };
  };
  afterEach(() => vi.useRealTimers());

  it("reloads every 15 s and stops at 90 s", async () => {
    const { onChange } = await start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(75_000);
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(5);
    const total = onChange.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange).toHaveBeenCalledTimes(total);
  });

  it("stops once the last login time changes", async () => {
    const { api, onChange, view } = await start();
    await vi.advanceTimersByTimeAsync(15_000);
    view.rerender(<AutoLoginCard api={api} supplier={aSupplier({ ...saved, lastAutoLoginAt: "2026-11-17T07:10:00.000Z", lastAutoLoginResult: "ok" })} onChange={onChange} />);
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops when the card goes away", async () => {
    const { onChange, view } = await start();
    view.unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
