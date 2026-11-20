// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { aSupplier, fakeApi } from "../test/fake-api.js";
import { RegionPanel } from "./PermissionPanel.js";

afterEach(cleanup);

describe("RegionPanel", () => {
  it("tells the page once the region is saved, so the supplier is read again", async () => {
    const api = fakeApi();
    const onSaved = vi.fn();
    render(<RegionPanel api={api} supplier={aSupplier()} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "UK");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Region saved.")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
