// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { App } from "./App.js";
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

  it("shows the home page for a signed-in owner", async () => {
    render(<App api={fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" }) })} />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("moves to the home page after a successful sign in", async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi()} />);
    await user.type(await screen.findByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("returns to the sign-in page after signing out", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" }) });
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalled();
  });

  it("shows a plain message when the server cannot be reached at start", async () => {
    render(<App api={fakeApi({ getMe: vi.fn().mockRejectedValue(new Error("Can't reach the server. Check your connection and try again.")) })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
  });

  describe("pages", () => {
    const signedIn = () => fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" } satisfies Owner) });

    it("opens the Shopify settings page at its own address, so it can be bookmarked or reloaded", async () => {
      window.history.replaceState(null, "", "/settings/shopify");
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Shopify settings" })).toBeInTheDocument();
      expect(document.title).toBe("Shopify settings · Stock Monitor");
    });

    it("treats /settings as the Shopify settings page", async () => {
      window.history.replaceState(null, "", "/settings");
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Shopify settings" })).toBeInTheDocument();
    });

    it("moves between pages from the sidebar without reloading", async () => {
      const user = userEvent.setup();
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "Settings" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Shopify settings" })).toBeInTheDocument();
      expect(window.location.pathname).toBe("/settings/shopify");
      await user.click(screen.getByRole("link", { name: "Dashboard" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
      expect(document.title).toBe("Dashboard · Stock Monitor");
    });

    it("says plainly when an address does not exist, and offers a way back", async () => {
      window.history.replaceState(null, "", "/suppliers/42");
      const user = userEvent.setup();
      render(<App api={signedIn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
      expect(document.title).toBe("Page not found · Stock Monitor");
      await user.click(screen.getByRole("link", { name: "Go to the dashboard" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    });

    it("shows the sign-in page, whatever the address, when nobody is signed in", async () => {
      window.history.replaceState(null, "", "/settings/shopify");
      render(<App api={fakeApi()} />);
      expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    });
  });
});
