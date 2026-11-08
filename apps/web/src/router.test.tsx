// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Link, navigate, usePath } from "./router.js";

function Where() {
  return <p data-testid="where">{usePath()}</p>;
}

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("router", () => {
  it("reports the current path", () => {
    window.history.replaceState(null, "", "/settings/shopify");
    render(<Where />);
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/shopify");
  });

  it("changes the path without reloading the page", () => {
    render(<Where />);
    act(() => navigate("/settings/shopify"));
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/shopify");
    expect(window.location.pathname).toBe("/settings/shopify");
  });

  it("follows the browser's back and forward buttons", () => {
    render(<Where />);
    act(() => navigate("/a"));
    act(() => navigate("/b"));
    act(() => window.history.back());
    return new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => {
        queueMicrotask(() => {
          expect(screen.getByTestId("where")).toHaveTextContent("/a");
          resolve();
        });
      }, { once: true }),
    );
  });

  it("does not add a history entry when going to the page it is already on", () => {
    render(<Where />);
    const before = window.history.length;
    act(() => navigate("/"));
    expect(window.history.length).toBe(before);
  });

  it("a Link is a real link to the address, and a plain click moves without reloading", async () => {
    render(
      <>
        <Link to="/settings/shopify">Settings</Link>
        <Where />
      </>,
    );
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings/shopify");
    await userEvent.setup().click(link);
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/shopify");
  });

  it("leaves a modified click to the browser, so open-in-new-tab still works", async () => {
    render(
      <>
        <Link to="/settings/shopify">Settings</Link>
        <Where />
      </>,
    );
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.keyboard("{/Control}");
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });
});
