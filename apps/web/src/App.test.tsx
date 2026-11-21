// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { App } from "./App.js";
import { navigate } from "./router.js";
import type { Owner } from "./api.js";
import { fakeApi } from "./test/fake-api.js";

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("App", () => {
  it("says it is checking while it looks for an existing session", () => {
    render(<App api={fakeApi({ getMe: vi.fn((): Promise<Owner | null> => new Promise(() => {})) })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("shows the sign-in page when nobody is signed in", async () => {
    render(<App api={fakeApi()} />);
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("never asks for the waiting count while nobody is signed in", async () => {
    const api = fakeApi();
    render(<App api={api} />);
    await screen.findByRole("heading", { name: /sign in/i });
    expect(api.proposals.count).not.toHaveBeenCalled();
  });

  it("shows the waiting count in the menu once signed in", async () => {
    const api = fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" }), proposals: { count: vi.fn().mockResolvedValue(4) } });
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await waitFor(() => expect(document.title).toMatch(/^\(4\)/));
  });

  it("shows the home page for a signed-in owner", async () => {
    render(<App api={fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" }) })} />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(within(screen.getByRole("menu")).getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("moves to the home page after a successful sign in", async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi()} />);
    await user.type(await screen.findByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "Account" })).toBeInTheDocument();
  });

  it("returns to the sign-in page after signing out", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" }) });
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalled();
    // Plain /login: signing in again goes to the Dashboard, not back to the page signed out from.
    expect(window.location.pathname + window.location.search).toBe("/login");
  });

  it("after a sign-out that failed, Try again checks the session afresh", async () => {
    const user = userEvent.setup();
    let answer: (owner: Owner | null) => void = () => {};
    const getMe = vi
      .fn()
      .mockResolvedValueOnce({ email: "owner@example.com" })
      .mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const api = fakeApi({ getMe, logout: vi.fn().mockRejectedValue(new Error("Can't reach the server.")) });
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByRole("heading", { name: "Dashboard" })).toBeNull();
    await act(async () => answer(null));
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows a plain message when the server cannot be reached at start", async () => {
    render(<App api={fakeApi({ getMe: vi.fn().mockRejectedValue(new Error("Can't reach the server. Check your connection and try again.")) })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
  });

  describe("pages", () => {
    const signedIn = () => fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" } satisfies Owner) });

    it("opens the connect screen for a supplier at its own address", async () => {
      window.history.replaceState(null, "", "/suppliers/11111111-1111-4111-8111-111111111111/connect");
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Connect Acme Supply" })).toBeInTheDocument();
    });

    it("opens the Shopify settings page at its own address, so it can be bookmarked or reloaded", async () => {
      window.history.replaceState(null, "", "/settings/shopify");
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("Settings · Stock Monitor")); // set after render, so wait for it
    });

    it("opens the products page at its own address", async () => {
      window.history.replaceState(null, "", "/products");
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("Products · Stock Monitor")); // set after render, so wait for it
    });

    it("treats /settings as the Shopify settings page", async () => {
      window.history.replaceState(null, "", "/settings");
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    });

    it("moves between pages from the sidebar without reloading", async () => {
      const user = userEvent.setup();
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "Settings" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
      expect(window.location.pathname).toBe("/settings/shopify");
      await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Dashboard" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("Dashboard · Stock Monitor")); // set after render, so wait for it
    });

    it("says plainly when an address does not exist, and offers a way back", async () => {
      window.history.replaceState(null, "", "/suppliers/42");
      const user = userEvent.setup();
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("Page not found · Stock Monitor")); // set after render, so wait for it
      expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "Go to the dashboard" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    });

    it("shows the sign-in page, whatever the address, when nobody is signed in", async () => {
      window.history.replaceState(null, "", "/settings/shopify");
      render(<App api={fakeApi()} />);
      expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    });

    it("moves a signed-out visitor to /login, remembering where they were going", async () => {
      window.history.replaceState(null, "", "/settings/shopify?x=1");
      render(<App api={fakeApi()} />);
      await screen.findByRole("heading", { name: /sign in/i });
      expect(window.location.pathname).toBe("/login");
      expect(new URLSearchParams(window.location.search).get("next")).toBe("/settings/shopify?x=1");
    });

    it("goes back to where the owner was going once they sign in", async () => {
      window.history.replaceState(null, "", "/login?next=%2Fsuppliers");
      const user = userEvent.setup();
      render(<App api={fakeApi({ login: vi.fn().mockResolvedValue({ email: "owner@example.com" }) })} />);
      await user.type(await screen.findByLabelText("Email"), "owner@example.com");
      await user.type(screen.getByLabelText("Password", { exact: true }), "correct horse battery staple");
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Suppliers" })).toBeInTheDocument();
      expect(window.location.pathname).toBe("/suppliers");
    });

    it.each(["//evil.example/x", "https://evil.example/", "javascript:alert(1)"])("never follows %s after signing in, only addresses inside the app", async (next) => {
      window.history.replaceState(null, "", `/login?next=${encodeURIComponent(next)}`);
      const user = userEvent.setup();
      render(<App api={fakeApi({ login: vi.fn().mockResolvedValue({ email: "owner@example.com" }) })} />);
      await user.type(await screen.findByLabelText("Email"), "owner@example.com");
      await user.type(screen.getByLabelText("Password", { exact: true }), "correct horse battery staple");
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
    });

    it("sends a signed-in owner from /login to the app", async () => {
      window.history.replaceState(null, "", "/login");
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
    });
  });
});

describe("reading only what is needed", () => {
  const owner = { getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" }) };

  it("reads the schedule once for the sidebar and the supplier's schedule panel together", async () => {
    window.history.replaceState(null, "", "/suppliers/11111111-1111-4111-8111-111111111111/edit");
    const api = fakeApi(owner);
    render(<App api={api} />);
    await screen.findByRole("group", { name: "Automatic checks" });
    await act(async () => void (await new Promise((r) => setTimeout(r, 200))));
    expect(api.schedule.overview).toHaveBeenCalledTimes(1);
  });

  it("does not read notifications again on every page change", async () => {
    window.history.replaceState(null, "", "/");
    const api = fakeApi(owner);
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Dashboard" });
    await waitFor(() => expect(api.notifications.list).toHaveBeenCalledTimes(1));
    await act(async () => navigate("/products"));
    await screen.findByRole("heading", { name: "Products" });
    await act(async () => navigate("/suppliers"));
    await screen.findByRole("heading", { name: "Suppliers" });
    await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
    expect(api.notifications.list).toHaveBeenCalledTimes(1);
  });
});
