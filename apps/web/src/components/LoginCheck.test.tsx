// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError, type LoginInspection } from "../api.js";
import { aSupplier, fakeApi } from "../test/fake-api.js";
import { LoginCheck } from "./LoginCheck.js";

afterEach(cleanup);
const c = (label: string, selector: string) => ({ label, selector });
const inspection = (over: Partial<LoginInspection> = {}): LoginInspection => ({
  state: "form",
  opened: false,
  found: { open: null, account: null, username: c("Email", "#UserName"), password: c("Password", "#Password"), submit: c("login to your account", "#dupbtn") },
  fields: [c("Email", "#UserName"), c("Password", "#Password"), c("Search", 'input[name="q"]')],
  buttons: [c("login to your account", "#dupbtn"), c("Forgot password", 'a:text-is("Forgot password")')],
  ...over,
});
const granted = { automationPermission: "granted" as const };
const setup = (answer: LoginInspection | Error = inspection(), supplier = aSupplier(granted)) => {
  const inspectLogin = answer instanceof Error ? vi.fn().mockRejectedValue(answer) : vi.fn().mockResolvedValue(answer);
  const api = fakeApi({ suppliers: { inspectLogin } });
  const onSaved = vi.fn();
  render(<LoginCheck api={api} supplier={supplier} onSaved={onSaved} />);
  return { api, onSaved, inspectLogin, user: userEvent.setup() };
};
const check = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Check login page" }));

describe("Check login page", () => {
  it("shows one row per role, each starting on what a login would use", async () => {
    const { inspectLogin, user } = setup();
    await check(user);
    expect(inspectLogin).toHaveBeenCalledWith(aSupplier().id);
    expect(await screen.findByLabelText("Username box")).toHaveDisplayValue("Automatic: Email");
    expect(screen.getByLabelText("Password box")).toHaveDisplayValue("Automatic: Password");
    expect(screen.getByLabelText("Button that logs in")).toHaveDisplayValue("Automatic: login to your account");
    expect(screen.getByLabelText("Account box")).toHaveDisplayValue("Automatic: not found");
    expect(screen.queryByLabelText("Button that opens the login")).not.toBeInTheDocument();
  });

  it("says a login box was not found and to pick one", async () => {
    const { user } = setup(inspection({ found: { open: null, account: null, username: null, password: c("Password", "#Password"), submit: null } }));
    await check(user);
    expect(await screen.findByLabelText("Username box")).toHaveDisplayValue("Automatic: not found");
    expect(screen.getAllByText(/Not found\. Pick one from the list/).length).toBe(2);
  });

  it("shows the open button row when the login was behind one", async () => {
    const { user } = setup(inspection({ opened: true, found: { ...inspection().found, open: c("Customer login", "#cl") } }));
    await check(user);
    expect(await screen.findByLabelText("Button that opens the login")).toHaveDisplayValue("Automatic: Customer login");
  });

  it("saves nothing until Save choices is pressed, then saves the picked selector and tells the card", async () => {
    const { api, onSaved, user } = setup();
    await check(user);
    await user.selectOptions(await screen.findByLabelText("Username box"), "Search");
    expect(api.suppliers.setAutoLogin).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save choices" }));
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { loginSelectors: { username: 'input[name="q"]' } });
    expect(onSaved).toHaveBeenCalledWith({ username: 'input[name="q"]' });
    expect(await screen.findByText("Login fields saved.")).toBeInTheDocument();
  });

  it("leaving everything on Automatic clears the saved selectors", async () => {
    const { api, onSaved, user } = setup(inspection(), aSupplier({ ...granted, loginSelectors: { username: "#UserName" } }));
    await check(user);
    await user.selectOptions(await screen.findByLabelText("Username box"), "Automatic: Email");
    await user.click(screen.getByRole("button", { name: "Save choices" }));
    expect(api.suppliers.setAutoLogin).toHaveBeenCalledWith(aSupplier().id, { loginSelectors: null });
    expect(onSaved).toHaveBeenCalledWith(null);
  });

  it("starts on a saved selector, including one that is no longer on the page", async () => {
    const { user } = setup(inspection(), aSupplier({ ...granted, loginSelectors: { username: "#UserName", password: "#old-pw" } }));
    await check(user);
    expect(await screen.findByLabelText("Username box")).toHaveDisplayValue("Email");
    expect(screen.getByLabelText("Password box")).toHaveDisplayValue("Saved: #old-pw");
  });

  it.each([
    ["captcha", /showed a puzzle/],
    ["unreachable", /Could not reach the login page/],
    ["none", /No login box or login button was found/],
  ] as const)("says plainly what a %s page means, with no rows", async (state, words) => {
    const { user } = setup(inspection({ state, fields: [], buttons: [], found: { open: null, account: null, username: null, password: null, submit: null } }));
    await check(user);
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(screen.queryByLabelText("Username box")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save choices" })).not.toBeInTheDocument();
  });

  it("shows the plain refusal when the check fails", async () => {
    const { user } = setup(new ApiError("The browser service did not answer. Try again in a minute.", 503, "browser_unavailable"));
    await check(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("The browser service did not answer");
  });

  it("is disabled, with the reason, until automatic checks are allowed", () => {
    setup(inspection(), aSupplier({ automationPermission: "unknown" }));
    expect(screen.getByRole("button", { name: "Check login page" })).toBeDisabled();
    expect(screen.getByText("Needs “Allows automatic checks” to be Yes.")).toBeInTheDocument();
  });
});
