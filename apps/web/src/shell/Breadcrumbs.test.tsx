// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Breadcrumbs, crumbsForPath } from "./Breadcrumbs.js";

afterEach(cleanup);

describe("Breadcrumbs", () => {
  it("links every crumb but the last, which marks the current page", () => {
    render(<Breadcrumbs items={[{ label: "Dashboard", to: "/" }, { label: "Suppliers", to: "/suppliers" }, { label: "Add supplier" }]} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Suppliers" })).toHaveAttribute("href", "/suppliers");
    expect(screen.getByText("Add supplier")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Add supplier" })).toBeNull();
  });
});

describe("crumbsForPath", () => {
  it.each([
    ["/", ["Dashboard"]],
    ["/suppliers", ["Dashboard", "Suppliers"]],
    ["/suppliers/new", ["Dashboard", "Suppliers", "Add supplier"]],
    ["/suppliers/abc/rules", ["Dashboard", "Suppliers", "Stock rules"]],
    ["/suppliers/abc/connect", ["Dashboard", "Suppliers", "Connect"]],
    ["/suppliers/abc/edit", ["Dashboard", "Suppliers", "Edit supplier"]],
    ["/mappings", ["Dashboard", "Links"]],
    ["/mappings/import", ["Dashboard", "Links", "Import links"]],
    ["/settings/shopify", ["Dashboard", "Settings", "Shopify"]],
    ["/nowhere", ["Dashboard", "Page not found"]],
  ])("%s", (path, labels) => {
    expect(crumbsForPath(path).map((c) => c.label)).toEqual(labels);
  });
});
