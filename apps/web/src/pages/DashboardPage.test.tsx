// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage.js";

afterEach(cleanup);

describe("DashboardPage", () => {
  it("has one page heading, Dashboard, with a plain-words description", () => {
    render(<DashboardPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/what needs your approval/i)).toBeInTheDocument();
  });

  it.each([
    ["Supplier connections", /no suppliers yet/i],
    ["Stock checks", /no checks scheduled/i],
    ["Waiting for your approval", /nothing to review/i],
  ])("shows an honest empty state for %s", (heading, message) => {
    render(<DashboardPage />);
    const card = screen.getByRole("heading", { level: 2, name: heading }).closest("section")!;
    expect(within(card).getByText(message)).toBeInTheDocument();
  });

  it("explains the four steps of how it works, in order", () => {
    render(<DashboardPage />);
    const steps = within(screen.getByRole("list", { name: "How it works" })).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent("Check suppliers");
    expect(steps[1]).toHaveTextContent("Propose changes");
    expect(steps[2]).toHaveTextContent("You approve");
    expect(steps[3]).toHaveTextContent("Update Shopify");
  });

  it("promises that nothing reaches Shopify without approval", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/only approved changes are sent/i)).toBeInTheDocument();
  });
});
