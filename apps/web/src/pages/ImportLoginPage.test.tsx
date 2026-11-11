// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api.js";
import { aSupplier, fakeApi } from "../test/fake-api.js";
import { ImportLoginPage } from "./ImportLoginPage.js";

const supplier = aSupplier();
const SECRET = "PASTED-COOKIE-SECRET-31ac";
afterEach(cleanup);

function setup(importCookies = vi.fn().mockResolvedValue({ kept: 14, dropped: 3, session: null })) {
  const api = fakeApi({ suppliers: { get: vi.fn().mockResolvedValue(supplier) }, loginSessions: { importCookies } });
  render(<ImportLoginPage api={api} supplierId={supplier.id} />);
  return { importCookies, user: userEvent.setup() };
}
const box = () => screen.findByRole("textbox", { name: "Cookie export (JSON)" });
const paste = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.click(await box());
  await user.paste(text);
};

describe("ImportLoginPage", () => {
  it("names the supplier and gives the three steps", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Import login for Acme Supply" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("keeps Import off until something is pasted", async () => {
    const { user } = setup();
    expect(screen.getByRole("button", { name: "Import login" })).toBeDisabled();
    await paste(user, "[]");
    expect(screen.getByRole("button", { name: "Import login" })).toBeEnabled();
  });

  it("sends the pasted text, then says what was kept and removes the text from the page", async () => {
    const { user, importCookies } = setup();
    await paste(user, `[{"value":"${SECRET}"}]`);
    await user.click(screen.getByRole("button", { name: "Import login" }));
    expect(importCookies).toHaveBeenCalledWith(supplier.id, `[{"value":"${SECRET}"}]`);
    expect(await screen.findByText(/Saved 14 cookies, ignored 3 from other sites/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(screen.getByRole("link", { name: "Back to suppliers" })).toHaveAttribute("href", "/suppliers");
  });

  it("uses singular words for one cookie and says nothing about ignored ones when none were", async () => {
    const { user } = setup(vi.fn().mockResolvedValue({ kept: 1, dropped: 0, session: null }));
    await paste(user, "[]");
    await user.click(screen.getByRole("button", { name: "Import login" }));
    expect(await screen.findByText(/Saved 1 cookie\. Checking the connection now\./)).toBeInTheDocument();
  });

  it("shows the server's plain message and keeps the text so it can be fixed", async () => {
    const { user } = setup(vi.fn().mockRejectedValue(new ApiError("That is not a cookie export.", 422, "nothing_to_import")));
    await paste(user, "hello");
    await user.click(screen.getByRole("button", { name: "Import login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not a cookie export.");
    expect(await box()).toHaveValue("hello");
  });

  it("sends once when pressed twice", async () => {
    const { user, importCookies } = setup(vi.fn().mockReturnValue(new Promise(() => {})));
    await paste(user, "[]");
    const button = screen.getByRole("button", { name: "Import login" });
    await user.click(button);
    await user.click(button);
    expect(importCookies).toHaveBeenCalledTimes(1);
  });
});
