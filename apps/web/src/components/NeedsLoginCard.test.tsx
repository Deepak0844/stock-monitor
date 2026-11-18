// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { aSupplier, fakeApi } from "../test/fake-api.js";
import { NeedsLoginCard } from "./NeedsLoginCard.js";

afterEach(cleanup);
const setup = (over: Parameters<typeof aSupplier>[0] = {}, apiOver: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi(apiOver);
  const onChange = vi.fn();
  render(<NeedsLoginCard api={api} supplier={aSupplier(over)} onChange={onChange} />);
  return { api, onChange, user: userEvent.setup() };
};

describe("Needs a login card", () => {
  it("shows the switch with its hint, on for a supplier that needs a login", () => {
    setup();
    const toggle = screen.getByRole("switch", { name: "Needs a login" });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription("Off when the supplier's product pages show stock without logging in.");
  });

  it("turns the login off and tells the page", async () => {
    const { api, onChange, user } = setup();
    await user.click(screen.getByRole("switch", { name: "Needs a login" }));
    expect(api.suppliers.setNeedsLogin).toHaveBeenCalledWith(aSupplier().id, false);
    expect(onChange).toHaveBeenCalled();
  });

  it("says the supplier is checked without logging in when off", () => {
    setup({ needsLogin: false });
    expect(screen.getByRole("switch", { name: "Needs a login" })).not.toBeChecked();
    expect(screen.getByText("Checked without logging in")).toBeInTheDocument();
  });

  it("shows the error when saving fails", async () => {
    const { user } = setup({}, { suppliers: { setNeedsLogin: vi.fn().mockRejectedValue(new Error("The supplier was not found.")) } });
    await user.click(screen.getByRole("switch", { name: "Needs a login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The supplier was not found.");
  });
});
