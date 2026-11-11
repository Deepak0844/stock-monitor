// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.js";

afterEach(cleanup);
const props = { open: true, title: "Delete Ashgrove?", description: "This removes its links.", confirmLabel: "Delete supplier" };

describe("ConfirmDialog", () => {
  it("asks once even when the button is clicked twice", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<ConfirmDialog {...props} onConfirm={onConfirm} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Delete supplier" });
    await userEvent.dblClick(button);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute("aria-busy", "true");
    finish();
  });

  it("closes after a successful confirm", async () => {
    const onClose = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={vi.fn().mockResolvedValue(undefined)} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete supplier" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("stays open and shows the problem when the action fails", async () => {
    const onClose = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={vi.fn().mockRejectedValue(new Error("Could not delete."))} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete supplier" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete supplier" })).toBeEnabled();
  });

  it("closes on Escape and on Cancel when idle", async () => {
    const onClose = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("cannot be cancelled while the action is running", async () => {
    const onClose = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={() => new Promise<void>(() => {})} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete supplier" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});
