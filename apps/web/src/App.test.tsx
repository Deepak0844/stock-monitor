// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { App } from "./App.js";
import type { Api, Owner } from "./api.js";

afterEach(cleanup);

const fakeApi = (over: Partial<Api> = {}): Api => ({
  getMe: vi.fn().mockResolvedValue(null),
  login: vi.fn().mockResolvedValue({ email: "owner@example.com" }),
  logout: vi.fn().mockResolvedValue(undefined),
  ...over,
});

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
    expect(await screen.findByRole("heading", { name: "Stock Monitor" })).toBeInTheDocument();
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
});
