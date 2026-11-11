// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field } from "./Field.js";

afterEach(cleanup);

describe("Field", () => {
  it("labels its control and shows the hint under it", () => {
    render(
      <Field id="url" label="Supplier page address" hint="Starts with https://">
        <input id="url" />
      </Field>,
    );
    expect(screen.getByLabelText("Supplier page address")).toBeInTheDocument();
    expect(screen.getByText("Starts with https://")).toBeInTheDocument();
  });

  it("shows the error with the id the control can point at", () => {
    render(
      <Field id="url" label="Supplier page address" error="Enter an address.">
        <input id="url" aria-describedby="url-error" />
      </Field>,
    );
    expect(screen.getByText("Enter an address.")).toHaveAttribute("id", "url-error");
    expect(screen.getByLabelText("Supplier page address")).toHaveAccessibleDescription("Enter an address.");
  });
});
