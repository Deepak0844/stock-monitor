// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api.js";
import { aLoginSession, aSupplier, fakeApi } from "../test/fake-api.js";
import { ConnectSupplierPage } from "./ConnectSupplierPage.js";

const TOKEN = "e".repeat(64);
const supplier = aSupplier();
const login = aLoginSession({ supplierId: supplier.id });

type WindowProps = { loginSessionId: string; token: string; expiresAt: string | null; onConnected: () => void; onFailed: (r: "refused" | "lost") => void; onExpired: () => void };
const windowProps = vi.fn<(p: WindowProps) => void>();
/** A stand-in for the live window that lets a test say what happened to it. */
const StubWindow = (props: WindowProps) => {
  windowProps(props);
  return <div data-testid="live-window" />;
};
const last = () => windowProps.mock.lastCall![0];

beforeEach(() => {
  windowProps.mockClear();
  window.history.replaceState(null, "", `/suppliers/${supplier.id}/connect`);
});
afterEach(cleanup);

function setup(over: Parameters<typeof fakeApi>[0] = {}, opts: { strict?: boolean } = {}) {
  const api = fakeApi({
    ...over,
    suppliers: { get: vi.fn().mockResolvedValue(supplier), ...over.suppliers },
    loginSessions: { start: vi.fn().mockResolvedValue({ loginSession: login, token: TOKEN }), ...over.loginSessions },
  });
  const ui = <ConnectSupplierPage api={api} supplierId={supplier.id} liveWindow={StubWindow} />;
  const view = render(opts.strict ? <StrictMode>{ui}</StrictMode> : ui);
  return { api, user: userEvent.setup(), ...view };
}
const connect = async () => {
  await screen.findByTestId("live-window");
  act(() => last().onConnected());
};

describe("starting", () => {
  it("names the supplier, says what to do, and opens a login window once, even when React runs effects twice", async () => {
    const { api } = setup({}, { strict: true });
    expect(await screen.findByRole("heading", { level: 1, name: "Connect Acme Supply" })).toBeInTheDocument();
    await screen.findByTestId("live-window");
    expect(api.loginSessions.start).toHaveBeenCalledTimes(1);
    expect(api.loginSessions.start).toHaveBeenCalledWith(supplier.id);
    expect(screen.getByText(/Log in as you normally would\. Solve any puzzle or code\. Then press I'm logged in\./)).toBeInTheDocument();
    expect(document.title).toBe("Connect supplier · Stock Monitor");
  });

  it("calls it Reconnect when the supplier has been connected before", async () => {
    setup({ suppliers: { get: vi.fn().mockResolvedValue(aSupplier({ sessionStatus: "needs_reconnect" })) } });
    expect(await screen.findByRole("heading", { level: 1, name: "Reconnect Acme Supply" })).toBeInTheDocument();
  });

  it("says plainly that a computer works best", async () => {
    setup();
    expect(await screen.findByText(/works best on a computer/i)).toBeInTheDocument();
  });

  it("shows that the window is opening, then gives the window its attempt, one-time token and end time", async () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Opening the login window…");
    await screen.findByTestId("live-window");
    expect(last()).toMatchObject({ loginSessionId: login.id, token: TOKEN, expiresAt: login.expiresAt });
  });

  it("never shows the token on the page", async () => {
    const { container } = setup();
    await screen.findByTestId("live-window");
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it("says plainly when the supplier does not exist, and starts nothing", async () => {
    const { api } = setup({ suppliers: { get: vi.fn().mockRejectedValue(new ApiError("That supplier does not exist.", 404, "supplier_not_found")) } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That supplier does not exist.");
    expect(screen.getByRole("link", { name: "Back to suppliers" })).toHaveAttribute("href", "/suppliers");
    expect(api.loginSessions.start).not.toHaveBeenCalled();
  });

  it("shows the server's plain message when a login cannot start, with a way to try again or go back", async () => {
    const start = vi.fn().mockRejectedValueOnce(new ApiError("A login window is already open. Finish or cancel it first.", 409, "login_open")).mockResolvedValue({ loginSession: login, token: TOKEN });
    const { user } = setup({ loginSessions: { start } });
    expect(await screen.findByRole("alert")).toHaveTextContent("A login window is already open. Finish or cancel it first.");
    expect(screen.queryByTestId("live-window")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to suppliers" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("live-window")).toBeInTheDocument();
  });
});

describe("finishing", () => {
  it("keeps I'm logged in off until the window is working", async () => {
    setup();
    await screen.findByTestId("live-window");
    expect(screen.getByRole("button", { name: "I'm logged in" })).toBeDisabled();
    act(() => last().onConnected());
    expect(screen.getByRole("button", { name: "I'm logged in" })).toBeEnabled();
  });

  it("saves the login, then says the supplier is connected, with a way back", async () => {
    const { api, user } = setup();
    await connect();
    await user.click(screen.getByRole("button", { name: "I'm logged in" }));
    expect(api.loginSessions.finish).toHaveBeenCalledWith(login.id);
    expect(await screen.findByText("Acme Supply is connected.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to suppliers" })).toHaveAttribute("href", "/suppliers");
    expect(screen.queryByTestId("live-window")).toBeNull();
  });

  it("shows Saving… and cannot be pressed twice while it saves", async () => {
    let done: () => void = () => {};
    const finish = vi.fn().mockReturnValue(new Promise((resolve) => (done = () => resolve({ loginSession: login, session: null }))));
    const { user } = setup({ loginSessions: { finish } });
    await connect();
    await user.click(screen.getByRole("button", { name: "I'm logged in" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    done();
    await screen.findByText("Acme Supply is connected.");
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("does not mistake the window closing, which saving causes, for a problem", async () => {
    let done: () => void = () => {};
    const finish = vi.fn().mockReturnValue(new Promise((resolve) => (done = () => resolve({ loginSession: login, session: null }))));
    const { user } = setup({ loginSessions: { finish } });
    await connect();
    await user.click(screen.getByRole("button", { name: "I'm logged in" }));
    act(() => last().onFailed("lost"));
    act(() => last().onExpired());
    expect(screen.queryByRole("alert")).toBeNull();
    done();
    expect(await screen.findByText("Acme Supply is connected.")).toBeInTheDocument();
  });

  it("shows the server's plain message when saving fails, and Try again opens a fresh login", async () => {
    const finish = vi.fn().mockRejectedValue(new ApiError("No login was found in the window. Log in to the supplier, then press I'm logged in. Start the login again to try again.", 422, "nothing_to_save"));
    const { api, user } = setup({ loginSessions: { finish } });
    await connect();
    await user.click(screen.getByRole("button", { name: "I'm logged in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No login was found in the window.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.loginSessions.start).toHaveBeenCalledTimes(2));
    expect(api.loginSessions.cancel).not.toHaveBeenCalled(); // the server already ended that login
  });
});

describe("cancelling", () => {
  it("cancels the login and goes back to the suppliers", async () => {
    const { api, user } = setup();
    await connect();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.loginSessions.cancel).toHaveBeenCalledWith(login.id);
    await waitFor(() => expect(window.location.pathname).toBe("/suppliers"));
    expect(api.loginSessions.cancelOnLeave).not.toHaveBeenCalled();
  });

  it("goes back even when the cancel cannot be sent", async () => {
    const cancel = vi.fn().mockRejectedValue(new ApiError("Can't reach the server. Check your connection and try again.", 0));
    const { user } = setup({ loginSessions: { cancel } });
    await connect();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(window.location.pathname).toBe("/suppliers"));
  });

  it("can be cancelled while the window is still opening", async () => {
    const { api, user } = setup();
    await screen.findByTestId("live-window");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.loginSessions.cancel).toHaveBeenCalledWith(login.id);
  });
});

describe("when the window has a problem", () => {
  it.each([
    ["refused", "The login window could not be opened. Please try again."],
    ["lost", "The connection to the login window was lost. Please try again."],
  ] as const)("says plainly what happened when the window reports %s", async (reason, message) => {
    setup();
    await screen.findByTestId("live-window");
    act(() => last().onFailed(reason));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByTestId("live-window")).toBeNull();
  });

  it("says the time ran out", async () => {
    setup();
    await screen.findByTestId("live-window");
    act(() => last().onExpired());
    expect(await screen.findByRole("alert")).toHaveTextContent("The login window closed because time ran out. Start again.");
  });

  it("closes the old login before opening a new one, so the new one is not refused as a second window", async () => {
    const calls: string[] = [];
    const start = vi.fn().mockImplementation(async () => (calls.push("start"), { loginSession: login, token: TOKEN }));
    const cancel = vi.fn().mockImplementation(async () => (calls.push("cancel"), aLoginSession({ status: "cancelled" })));
    const { user } = setup({ loginSessions: { start, cancel } });
    await screen.findByTestId("live-window");
    act(() => last().onFailed("refused"));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByTestId("live-window");
    expect(calls).toEqual(["start", "cancel", "start"]);
  });
});

describe("leaving the page", () => {
  it("cancels an open login when the page is closed", async () => {
    const { api } = setup();
    await screen.findByTestId("live-window");
    window.dispatchEvent(new Event("pagehide"));
    expect(api.loginSessions.cancelOnLeave).toHaveBeenCalledWith(login.id);
  });

  it("cancels an open login when the owner moves to another page of the app", async () => {
    const { api, unmount } = setup();
    await screen.findByTestId("live-window");
    unmount();
    expect(api.loginSessions.cancelOnLeave).toHaveBeenCalledWith(login.id);
  });

  it("does not cancel a login that is finished", async () => {
    const { api, user, unmount } = setup();
    await connect();
    await user.click(screen.getByRole("button", { name: "I'm logged in" }));
    await screen.findByText("Acme Supply is connected.");
    unmount();
    window.dispatchEvent(new Event("pagehide"));
    expect(api.loginSessions.cancelOnLeave).not.toHaveBeenCalled();
  });

  it("does nothing on leaving when no login was ever opened", async () => {
    const { api, unmount } = setup({ loginSessions: { start: vi.fn().mockRejectedValue(new ApiError("x", 409, "login_open")) } });
    await screen.findByRole("alert");
    unmount();
    expect(api.loginSessions.cancelOnLeave).not.toHaveBeenCalled();
  });
});
