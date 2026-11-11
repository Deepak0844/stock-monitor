// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Button } from "./button.js";
import { Badge } from "./badge.js";
import { Skeleton } from "./skeleton.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog.js";

afterEach(cleanup);

describe("Button", () => {
  it("is busy, disabled and silent while loading, and keeps its label", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls onClick when it is not loading", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Dialog", () => {
  it("opens, closes on Escape and returns focus to its trigger", async () => {
    render(
      <Dialog>
        <DialogTrigger asChild><button>Open</button></DialogTrigger>
        <DialogContent>
          <DialogTitle>Delete it?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Delete it?" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("Badge and Skeleton", () => {
  it("renders the badge text", () => {
    render(<Badge variant="warning">Needs reconnecting</Badge>);
    expect(screen.getByText("Needs reconnecting")).toBeInTheDocument();
  });
  it("hides the skeleton from assistive technology", () => {
    render(<Skeleton data-testid="s" />);
    expect(screen.getByTestId("s")).toHaveAttribute("aria-hidden", "true");
  });
});
