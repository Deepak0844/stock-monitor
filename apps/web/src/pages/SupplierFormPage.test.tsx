// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../api.js";
import { aSupplier, fakeApi } from "../test/fake-api.js";
import { SupplierFormPage } from "./SupplierFormPage.js";

beforeEach(() => window.history.replaceState(null, "", "/suppliers/new"));
afterEach(cleanup);

type U = ReturnType<typeof userEvent.setup>;
const fillNew = async (user: U, name = "Acme Supply", site = "https://shop.acme.example/") => {
  await user.type(screen.getByLabelText("Name"), name);
  await user.type(screen.getByLabelText("Website address"), site);
};

describe("adding a supplier", () => {
  const setup = (over: Parameters<typeof fakeApi>[0] = {}) => {
    const api = fakeApi(over);
    render(<SupplierFormPage api={api} />);
    return { api, user: userEvent.setup() };
  };

  it("has labelled fields with plain hints and a 60 minute default", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Add supplier" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Website address")).toBeInTheDocument();
    expect(screen.getByLabelText(/Login address/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Check every/)).toHaveValue(60);
    expect(screen.getByText(/starting with https:\/\//i)).toBeInTheDocument();
    expect(screen.getByText(/never asks for or stores/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/suppliers");
  });

  it("saves the supplier, then goes back to the list", async () => {
    const { api, user } = setup();
    await fillNew(user);
    await user.type(screen.getByLabelText(/Login address/), "https://shop.acme.example/sign-in");
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(api.suppliers.create).toHaveBeenCalledWith({
      name: "Acme Supply",
      websiteUrl: "https://shop.acme.example/",
      loginUrl: "https://shop.acme.example/sign-in",
      checkIntervalMinutes: 60,
    });
    await waitFor(() => expect(window.location.pathname).toBe("/suppliers"));
  });

  it("sends no login address when it is left blank, and trims the other fields", async () => {
    const { api, user } = setup();
    await fillNew(user, "  Acme  ", "  https://acme.example/ ");
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(api.suppliers.create).toHaveBeenCalledWith({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  });

  it("shows what is missing beside each field, focuses the first, and sends nothing", async () => {
    const { api, user } = setup();
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(screen.getByText("Enter a name for the supplier.")).toBeInTheDocument();
    expect(screen.getByText(/Enter the supplier's website address/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/Enter a name for the supplier\./);
    expect(api.suppliers.create).not.toHaveBeenCalled();
  });

  it.each(["14", "1441", "0", "", "60.5"])("refuses a check interval of %j beside its field", async (value) => {
    const { api, user } = setup();
    await fillNew(user);
    const interval = screen.getByLabelText(/Check every/);
    await user.clear(interval);
    if (value) await user.type(interval, value);
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(screen.getByText(/whole number of minutes from 15 to 1440/)).toBeInTheDocument();
    expect(interval).toHaveFocus();
    expect(api.suppliers.create).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_name", "Name"],
    ["name_taken", "Name"],
    ["invalid_website", "Website address"],
    ["invalid_login_url", "Login address"],
    ["invalid_interval", "Check every"],
  ])("shows the server's %s message beside the %s field", async (code, label) => {
    const create = vi.fn().mockRejectedValue(new ApiError(`Server says: ${code}.`, 400, code));
    const { user } = setup({ suppliers: { create } });
    await fillNew(user);
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    const message = await screen.findByText(`Server says: ${code}.`);
    expect(screen.getByLabelText(new RegExp(label))).toHaveAccessibleDescription(new RegExp(`Server says: ${code}\\.`));
    expect(message).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(label))).toHaveFocus();
    expect(window.location.pathname).toBe("/suppliers/new");
  });

  it("shows any other failure as a message above the buttons and keeps what was typed", async () => {
    const create = vi.fn().mockRejectedValue(new ApiError("Can't reach the server. Check your connection and try again.", 0));
    const { user } = setup({ suppliers: { create } });
    await fillNew(user);
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    expect(screen.getByLabelText("Name")).toHaveValue("Acme Supply");
  });

  it("disables the button while saving so it cannot be sent twice", async () => {
    let finish: () => void = () => {};
    const create = vi.fn().mockReturnValue(new Promise<ReturnType<typeof aSupplier>>((resolve) => (finish = () => resolve(aSupplier()))));
    const { user } = setup({ suppliers: { create } });
    await fillNew(user);
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    finish();
    await waitFor(() => expect(window.location.pathname).toBe("/suppliers"));
  });
});

describe("editing a supplier", () => {
  const existing = aSupplier({ loginUrl: "https://shop.acme.example/login", checkIntervalMinutes: 120 });
  const setup = (over: Parameters<typeof fakeApi>[0] = {}) => {
    window.history.replaceState(null, "", `/suppliers/${existing.id}/edit`);
    const api = fakeApi({ ...over, suppliers: { get: vi.fn().mockResolvedValue(existing), ...over.suppliers } });
    render(<SupplierFormPage api={api} id={existing.id} />);
    return { api, user: userEvent.setup() };
  };

  it("loads the supplier into the form", async () => {
    const { api } = setup();
    expect(await screen.findByRole("heading", { name: "Edit supplier" })).toBeInTheDocument();
    expect(api.suppliers.get).toHaveBeenCalledWith(existing.id);
    expect(await screen.findByLabelText("Name")).toHaveValue("Acme Supply");
    expect(screen.getByLabelText("Website address")).toHaveValue("https://shop.acme.example/");
    expect(screen.getByLabelText(/Login address/)).toHaveValue("https://shop.acme.example/login");
    expect(screen.getByLabelText(/Check every/)).toHaveValue(120);
  });

  it("sends only what changed", async () => {
    const { api, user } = setup();
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Acme Ltd");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.suppliers.update).toHaveBeenCalledWith(existing.id, { name: "Acme Ltd" });
    await waitFor(() => expect(window.location.pathname).toBe("/suppliers"));
  });

  it("clears the login address by sending null", async () => {
    const { api, user } = setup();
    await user.clear(await screen.findByLabelText(/Login address/));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.suppliers.update).toHaveBeenCalledWith(existing.id, { loginUrl: null });
  });

  it("sends nothing when nothing changed, and just goes back", async () => {
    const { api, user } = setup();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.suppliers.update).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.pathname).toBe("/suppliers"));
  });

  it("says plainly when the supplier does not exist, with a way back", async () => {
    setup({ suppliers: { get: vi.fn().mockRejectedValue(new ApiError("That supplier does not exist.", 404, "supplier_not_found")) } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That supplier does not exist.");
    expect(screen.getByRole("link", { name: "Back to suppliers" })).toHaveAttribute("href", "/suppliers");
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("shows a duplicate name beside the name field", async () => {
    const update = vi.fn().mockRejectedValue(new ApiError("You already have a supplier with that name.", 409, "name_taken"));
    const { user } = setup({ suppliers: { update } });
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Globex");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("You already have a supplier with that name.")).toBeInTheDocument();
    expect(name).toHaveFocus();
  });
});
