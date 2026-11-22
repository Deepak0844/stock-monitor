// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../api.js";
import { aSupplier, fakeApi } from "../test/fake-api.js";
import { renderWithStore } from "../test/renderWithStore.js";
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
    renderWithStore(<SupplierFormPage api={api} />);
    return { api, user: userEvent.setup() };
  };

  it("has labelled fields with plain hints, and no old check-interval field", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Add supplier" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Website address")).toBeInTheDocument();
    expect(screen.getByLabelText(/Login address/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Check every/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Automatic checks" })).toBeNull();
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
    });
    await waitFor(() => expect(window.location.pathname).toBe("/suppliers"));
  });

  it("adds a supplier that needs no login, keeping the login address on screen but disabled and not sent", async () => {
    const { api, user } = setup();
    await fillNew(user);
    await user.type(screen.getByLabelText(/Login address/), "https://shop.acme.example/sign-in");
    const toggle = screen.getByRole("switch", { name: "Needs a login" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(screen.getByLabelText(/Login address/)).toBeDisabled();
    expect(screen.getByLabelText(/Login address/)).toHaveValue("https://shop.acme.example/sign-in");
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(api.suppliers.create).toHaveBeenCalledWith({ name: "Acme Supply", websiteUrl: "https://shop.acme.example/", loginUrl: null, needsLogin: false });
  });

  it("sends no login address when it is left blank, and trims the other fields", async () => {
    const { api, user } = setup();
    await fillNew(user, "  Acme  ", "  https://acme.example/ ");
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(api.suppliers.create).toHaveBeenCalledWith({
      name: "Acme",
      websiteUrl: "https://acme.example/",
      loginUrl: null,
    });
  });

  it("shows what is missing beside each field, focuses the first, and sends nothing", async () => {
    const { api, user } = setup();
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(screen.getByText("Enter a name for the supplier.")).toBeInTheDocument();
    expect(screen.getByText(/Enter the supplier's website address/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(
      /Enter a name for the supplier\./,
    );
    expect(api.suppliers.create).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_name", "^Name$"],
    ["name_taken", "^Name$"],
    ["invalid_website", "Website address"],
    ["invalid_login_url", "Login address"],
  ])("shows the server's %s message beside the %s field", async (code, label) => {
    const create = vi.fn().mockRejectedValue(new ApiError(`Server says: ${code}.`, 400, code));
    const { user } = setup({ suppliers: { create } });
    await fillNew(user);
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    const message = await screen.findByText(`Server says: ${code}.`);
    expect(screen.getByLabelText(new RegExp(label))).toHaveAccessibleDescription(
      new RegExp(`Server says: ${code}\\.`),
    );
    expect(message).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(label))).toHaveFocus();
    expect(window.location.pathname).toBe("/suppliers/new");
  });

  it("shows any other failure as a message above the buttons and keeps what was typed", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        new ApiError("Can't reach the server. Check your connection and try again.", 0),
      );
    const { user } = setup({ suppliers: { create } });
    await fillNew(user);
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    expect(screen.getByLabelText("Name")).toHaveValue("Acme Supply");
  });

  it("disables the button while saving so it cannot be sent twice", async () => {
    let finish: () => void = () => {};
    const create = vi
      .fn()
      .mockReturnValue(
        new Promise<ReturnType<typeof aSupplier>>(
          (resolve) => (finish = () => resolve(aSupplier())),
        ),
      );
    const { user } = setup({ suppliers: { create } });
    await fillNew(user);
    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    finish();
    await waitFor(() => expect(window.location.pathname).toBe("/suppliers"));
  });
});

describe("editing a supplier", () => {
  const existing = aSupplier({ loginUrl: "https://shop.acme.example/login" });
  const setup = (over: Parameters<typeof fakeApi>[0] = {}) => {
    window.history.replaceState(null, "", `/suppliers/${existing.id}/edit`);
    const api = fakeApi({
      ...over,
      suppliers: { get: vi.fn().mockResolvedValue(existing), ...over.suppliers },
    });
    renderWithStore(<SupplierFormPage api={api} id={existing.id} />);
    return { api, user: userEvent.setup() };
  };

  it("loads the supplier into the form", async () => {
    const { api } = setup();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme Supply" }),
    ).toBeInTheDocument();
    expect(api.suppliers.get).toHaveBeenCalledWith(existing.id);
    expect(await screen.findByLabelText("Name")).toHaveValue("Acme Supply");
    expect(screen.getByLabelText("Website address")).toHaveValue("https://shop.acme.example/");
    expect(screen.getByLabelText(/Login address/)).toHaveValue("https://shop.acme.example/login");
    expect(screen.queryByLabelText(/Check every/)).toBeNull();
  });

  it("shows the Automatic checks panel for an existing supplier", async () => {
    setup();
    expect(await screen.findByRole("group", { name: "Automatic checks" })).toBeInTheDocument();
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
    setup({
      suppliers: {
        get: vi
          .fn()
          .mockRejectedValue(
            new ApiError("That supplier does not exist.", 404, "supplier_not_found"),
          ),
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("That supplier does not exist.");
    expect(screen.getByRole("link", { name: "Back to suppliers" })).toHaveAttribute(
      "href",
      "/suppliers",
    );
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("shows a duplicate name beside the name field", async () => {
    const update = vi
      .fn()
      .mockRejectedValue(
        new ApiError("You already have a supplier with that name.", 409, "name_taken"),
      );
    const { user } = setup({ suppliers: { update } });
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Globex");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("You already have a supplier with that name."),
    ).toBeInTheDocument();
    expect(name).toHaveFocus();
  });
});

describe("permission to check automatically", () => {
  const setupEdit = (supplier = aSupplier(), over: Parameters<typeof fakeApi>[0] = {}) => {
    const api = fakeApi({
      ...over,
      suppliers: { get: vi.fn().mockResolvedValue(supplier), ...over.suppliers },
    });
    renderWithStore(<SupplierFormPage api={api} id={supplier.id} />);
    return { api, user: userEvent.setup() };
  };

  it("is not shown when adding a supplier", () => {
    renderWithStore(<SupplierFormPage api={fakeApi()} />);
    expect(screen.queryByRole("group", { name: "Permission to check automatically" })).toBeNull();
  });

  it("starts as not recorded and says what that means", async () => {
    setupEdit();
    const group = await screen.findByRole("group", { name: "Permission to check automatically" });
    expect(group).toHaveTextContent("Not recorded");
    expect(group).toHaveTextContent(/Link checks stay off/);
  });

  it("records the decision, a note and the pause between pages", async () => {
    const { api, user } = setupEdit();
    await user.selectOptions(await screen.findByLabelText("Permission"), "granted");
    await user.type(
      screen.getByLabelText("Note about the permission (optional)"),
      "Emailed 10 Nov",
    );
    const pause = screen.getByLabelText("Pause between pages (seconds)");
    await user.clear(pause);
    await user.type(pause, "15");
    await user.click(screen.getByRole("button", { name: "Save permission" }));
    await waitFor(() =>
      expect(api.suppliers.setPermission).toHaveBeenCalledWith(aSupplier().id, {
        status: "granted",
        note: "Emailed 10 Nov",
        pauseSeconds: 15,
      }),
    );
    expect(await screen.findByText("Permission saved.")).toBeInTheDocument();
  });

  it("refuses a pause that is not a whole number of seconds, beside the field", async () => {
    const { api, user } = setupEdit();
    const pause = await screen.findByLabelText("Pause between pages (seconds)");
    await user.clear(pause);
    await user.type(pause, "0");
    await user.click(screen.getByRole("button", { name: "Save permission" }));
    expect(screen.getByText("Enter a whole number of seconds from 1 to 3600.")).toBeInTheDocument();
    expect(api.suppliers.setPermission).not.toHaveBeenCalled();
  });
});

describe("default region", () => {
  const setupEdit = (supplier = aSupplier()) => {
    const api = fakeApi({ suppliers: { get: vi.fn().mockResolvedValue(supplier) } });
    renderWithStore(<SupplierFormPage api={api} id={supplier.id} />);
    return { api, user: userEvent.setup() };
  };

  it("is not shown when adding a supplier", () => {
    renderWithStore(<SupplierFormPage api={fakeApi()} />);
    expect(screen.queryByLabelText("Default region (optional)")).toBeNull();
  });

  it("saves the region stock checks look for, and clears it", async () => {
    const { api, user } = setupEdit(aSupplier({ defaultRegion: "Bristol" }));
    const field = await screen.findByLabelText("Default region (optional)");
    expect(field).toHaveValue("Bristol");
    await user.clear(field);
    await user.type(field, "Loughborough");
    await user.click(screen.getByRole("button", { name: "Save region" }));
    await waitFor(() =>
      expect(api.suppliers.setRegion).toHaveBeenCalledWith(aSupplier().id, "Loughborough"),
    );
    expect(await screen.findByText("Region saved.")).toBeInTheDocument();
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Save region" }));
    await waitFor(() =>
      expect(api.suppliers.setRegion).toHaveBeenLastCalledWith(aSupplier().id, null),
    );
  });

  it("shows the server's plain message when it is refused", async () => {
    const setRegion = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          "A region can be up to 200 characters of text, or empty to clear it.",
          400,
          "invalid_region",
        ),
      );
    const api = fakeApi({ suppliers: { get: vi.fn().mockResolvedValue(aSupplier()), setRegion } });
    renderWithStore(<SupplierFormPage api={api} id={aSupplier().id} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Save region" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("up to 200 characters");
  });
});

describe("permission and automatic login on the same page", () => {
  it("enables the Automatic login switch after permission is saved as Allowed", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    window.history.replaceState(null, "", `/suppliers/${id}`);
    const get = vi
      .fn()
      .mockResolvedValueOnce(aSupplier())
      .mockResolvedValue(aSupplier({ automationPermission: "granted" }));
    const api = fakeApi({ suppliers: { get } });
    renderWithStore(<SupplierFormPage api={api} id={id} />);
    const user = userEvent.setup();
    expect(await screen.findByRole("switch", { name: "Automatic login" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Permission"), "granted");
    await user.click(screen.getByRole("button", { name: "Save permission" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Automatic login" })).toBeEnabled(),
    );
  });
});

describe("a supplier that needs no login", () => {
  const setupEdit = (supplier = aSupplier()) => {
    const api = fakeApi({ suppliers: { get: vi.fn().mockResolvedValue(supplier) } });
    renderWithStore(<SupplierFormPage api={api} id={supplier.id} />);
    return { api, user: userEvent.setup() };
  };

  it("shows the Needs a login switch above the login settings", async () => {
    setupEdit();
    expect(await screen.findByRole("switch", { name: "Needs a login" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Automatic login" })).toBeInTheDocument();
    expect(screen.getByLabelText("Keep login alive")).toBeInTheDocument();
  });

  it("hides automatic login and keep-alive when no login is needed", async () => {
    setupEdit(aSupplier({ needsLogin: false }));
    expect(await screen.findByRole("switch", { name: "Needs a login" })).not.toBeChecked();
    expect(screen.queryByRole("switch", { name: "Automatic login" })).toBeNull();
    expect(screen.queryByLabelText("Keep login alive")).toBeNull();
    expect(screen.getByText("Checked without logging in")).toBeInTheDocument();
  });
});

describe("name in Shopify", () => {
  it("sends the name in Shopify with a new supplier, with its hint", async () => {
    const api = fakeApi();
    renderWithStore(<SupplierFormPage api={api} />);
    const user = userEvent.setup();
    await fillNew(user);
    expect(
      screen.getByText(
        "The supplier name your Shopify products use (the custom.supplier_name field). Leave it empty if it is the same as the name above.",
      ),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name in Shopify (optional)"), " Acme Trading ");
    await user.click(screen.getByRole("button", { name: /^(Add|Save)/ }));
    await waitFor(() =>
      expect(api.suppliers.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Acme Supply", shopifyName: "Acme Trading" }),
      ),
    );
  });

  it("shows a supplier's name in Shopify, and clears it", async () => {
    const existing = aSupplier({ shopifyName: "Acme Trading" });
    window.history.replaceState(null, "", `/suppliers/${existing.id}/edit`);
    const api = fakeApi({ suppliers: { get: vi.fn().mockResolvedValue(existing) } });
    renderWithStore(<SupplierFormPage api={api} id={existing.id} />);
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Name in Shopify (optional)");
    expect(field).toHaveValue("Acme Trading");
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api.suppliers.update).toHaveBeenCalledWith(existing.id, { shopifyName: null }),
    );
  });

  it("puts a clash with another supplier under the field and focuses it", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          "Another supplier already uses that name for Shopify matching.",
          409,
          "shopify_name_taken",
        ),
      );
    const api = fakeApi({ suppliers: { create } });
    renderWithStore(<SupplierFormPage api={api} />);
    const user = userEvent.setup();
    await fillNew(user);
    await user.type(screen.getByLabelText("Name in Shopify (optional)"), "Acme");
    await user.click(screen.getByRole("button", { name: /^(Add|Save)/ }));
    await waitFor(() => expect(screen.getByLabelText("Name in Shopify (optional)")).toHaveFocus());
    expect(screen.getByLabelText("Name in Shopify (optional)")).toHaveAccessibleDescription(
      /Another supplier already uses that name/,
    );
  });
});

describe("the edit page layout", () => {
  const show = (supplier = aSupplier({ name: "Acme Supply", sessionStatus: "connected" })) => {
    renderWithStore(
      <SupplierFormPage
        api={fakeApi({ suppliers: { get: vi.fn().mockResolvedValue(supplier) } })}
        id={supplier.id}
      />,
    );
    return supplier;
  };

  it("puts the supplier's name, its status and its website at the top, with a way to its stock rules", async () => {
    const s = show();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme Supply" }),
    ).toBeInTheDocument();
    const facts = screen.getByRole("list", { name: "About this supplier" });
    expect(within(facts).getByText("Connected")).toBeInTheDocument();
    expect(within(facts).getByText("shop.acme.example")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stock rules" })).toHaveAttribute(
      "href",
      `/suppliers/${s.id}/rules`,
    );
  });

  it("lists its parts with where each stands, and each part is a place on the page", async () => {
    show(
      aSupplier({
        automationPermission: "granted",
        defaultRegion: null,
        scheduleIntervalMinutes: null,
        needsLogin: true,
        autoLogin: false,
      }),
    );
    const index = await screen.findByRole("navigation", { name: "Parts of this supplier" });
    const parts = within(index)
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(parts).toEqual([
      ["Details", "#part-details"],
      ["PermissionAllowed", "#part-permission"],
      ["RegionNone", "#part-region"],
      ["Automatic checksOff", "#part-checks"],
      ["LoginNeeded", "#part-login"],
      ["Automatic loginOff", "#part-auto-login"],
    ]);
    for (const id of ["details", "permission", "region", "checks", "login", "auto-login"])
      expect(document.getElementById(`part-${id}`)).not.toBeNull();
  });
});
