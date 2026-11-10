// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../../api.js";
import { fakeApi } from "../../test/fake-api.js";
import { ProposalSettingsCard } from "./ProposalSettingsCard.js";

afterEach(cleanup);
const missing = { state: "missing" as const, message: "Shopify has not given this app permission to change stock yet." };
const ready = { state: "ready" as const, message: "Shopify allows this app to change stock." };

const setup = (over: NonNullable<Parameters<typeof fakeApi>[0]>["proposals"] = {}) => {
  const api = fakeApi({ proposals: { settings: vi.fn().mockResolvedValue({ settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: ready }), ...over } });
  render(<ProposalSettingsCard api={api} />);
  return { api, user: userEvent.setup() };
};

describe("suggestion settings", () => {
  it("shows the saved numbers and whether Shopify allows the change", async () => {
    setup();
    expect(await screen.findByLabelText("Quantity for back-in-stock suggestions")).toHaveValue("5");
    expect(screen.getByLabelText("Hours a suggestion stays open")).toHaveValue("24");
    expect(screen.getByText("Shopify allows this app to change stock.")).toBeInTheDocument();
  });

  it("shows the missing permission in words", async () => {
    setup({ settings: vi.fn().mockResolvedValue({ settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: missing }) });
    expect(await screen.findByText(missing.message)).toBeInTheDocument();
  });

  it("saves new numbers and says so", async () => {
    const saveSettings = vi.fn().mockResolvedValue({ settings: { defaultQuantity: 8, expiryHours: 12 }, writePermission: ready });
    const { user } = setup({ saveSettings });
    const quantity = await screen.findByLabelText("Quantity for back-in-stock suggestions");
    await user.clear(quantity);
    await user.type(quantity, "8");
    const hours = screen.getByLabelText("Hours a suggestion stays open");
    await user.clear(hours);
    await user.type(hours, "12");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveSettings).toHaveBeenCalledWith({ defaultQuantity: 8, expiryHours: 12 });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it.each([["0", "24"], ["1.5", "24"], ["5", "0"], ["5", "721"], ["", "24"]])("refuses %s and %s next to the field without calling the server", async (q, h) => {
    const saveSettings = vi.fn();
    const { user } = setup({ saveSettings });
    const quantity = await screen.findByLabelText("Quantity for back-in-stock suggestions");
    await user.clear(quantity);
    if (q) await user.type(quantity, q);
    const hours = screen.getByLabelText("Hours a suggestion stays open");
    await user.clear(hours);
    await user.type(hours, h);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("shows the server's plain message when saving fails", async () => {
    const { user } = setup({ saveSettings: vi.fn().mockRejectedValue(new ApiError("Enter a default quantity from 1 to 100000 and an expiry from 1 to 720 hours.", 400)) });
    await screen.findByLabelText("Quantity for back-in-stock suggestions");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a default quantity");
  });
});
