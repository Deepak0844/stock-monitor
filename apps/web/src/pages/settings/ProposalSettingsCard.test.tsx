// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../../api.js";
import { fakeApi } from "../../test/fake-api.js";
import { renderWithQuery } from "../../test/renderWithQuery.js";
import { ProposalSettingsCard } from "./ProposalSettingsCard.js";

afterEach(cleanup);
const missing = { state: "missing" as const, message: "Shopify has not given this app permission to change stock yet." };
const ready = { state: "ready" as const, message: "Shopify allows this app to change stock." };

const setup = (over: NonNullable<Parameters<typeof fakeApi>[0]>["proposals"] = {}) => {
  const api = fakeApi({ proposals: { settings: vi.fn().mockResolvedValue({ settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: ready }), ...over } });
  renderWithQuery(<ProposalSettingsCard />, { api });
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

  it("says so when the settings can't be loaded, and shows no form", async () => {
    setup({ settings: vi.fn().mockRejectedValue(new ApiError("Sign in again to continue.", 401)) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again to continue.");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("keeps what the owner typed when saving fails", async () => {
    const { user } = setup({ saveSettings: vi.fn().mockRejectedValue(new ApiError("Can't reach the server. Check your connection and try again.", 0)) });
    const quantity = await screen.findByLabelText("Quantity for back-in-stock suggestions");
    await user.clear(quantity);
    await user.type(quantity, "9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
    expect(quantity).toHaveValue("9");
  });

  it("shows the permission the server gives back after a save", async () => {
    const { user } = setup({
      settings: vi.fn().mockResolvedValue({ settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: missing }),
      saveSettings: vi.fn().mockResolvedValue({ settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: ready }),
    });
    expect(await screen.findByText(missing.message)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(ready.message)).toBeInTheDocument();
    expect(screen.queryByText(missing.message)).not.toBeInTheDocument();
  });

  it("shows the server's plain message when saving fails", async () => {
    const { user } = setup({ saveSettings: vi.fn().mockRejectedValue(new ApiError("Enter a default quantity from 1 to 100000 and an expiry from 1 to 720 hours.", 400)) });
    await screen.findByLabelText("Quantity for back-in-stock suggestions");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a default quantity");
  });
});
