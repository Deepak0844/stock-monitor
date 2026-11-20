// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatRow, StatTile } from "./StatTile.js";
import { PageHeader } from "./PageHeader.js";

afterEach(cleanup);

describe("StatTile", () => {
  it("marks the chosen tile when it is a filter link", () => {
    render(
      <StatRow>
        <StatTile label="All suppliers" value={6} to="/suppliers" selected />
        <StatTile label="Connected" value={3} to="/suppliers?status=connected" />
      </StatRow>,
    );
    expect(screen.getByRole("link", { name: /All suppliers/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /Connected/ })).not.toHaveAttribute("aria-current");
  });
});

describe("PageHeader", () => {
  it("shows a back link above the title", () => {
    render(<PageHeader title="Add supplier" back={{ to: "/suppliers", label: "Back to suppliers" }} />);
    expect(screen.getByRole("link", { name: "← Back to suppliers" })).toHaveAttribute("href", "/suppliers");
    expect(screen.getByRole("heading", { level: 1, name: "Add supplier" })).toBeInTheDocument();
  });
});
