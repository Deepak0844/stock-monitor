// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { renderWithStore } from "../test/renderWithStore.js";
import { userEvent } from "@testing-library/user-event";
import { useNotifications } from "./useNotifications.js";
import { NotificationBell } from "./NotificationBell.js";
import { aNotification, fakeApi } from "../test/fake-api.js";
import type { Api } from "../api.js";

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

// The api is read by renderWithStore from this prop.
function Harness(_props: { api: Api }) {
  const state = useNotifications(true);
  return <NotificationBell state={state} />;
}
const unread = (id: string, over = {}) => aNotification({ id, readAt: null, ...over });
const setup = (
  items = [
    unread("n1"),
    unread("n2", {
      kind: "recipe_needs_review",
      message: "Acme Supply's pages changed. Review its stock rules.",
    }),
  ],
) => {
  const list = vi.fn().mockResolvedValue(items);
  const markRead = vi.fn().mockResolvedValue(undefined);
  const markAllRead = vi.fn().mockResolvedValue(undefined);
  const api = fakeApi({ notifications: { list, markRead, markAllRead } });
  renderWithStore(<Harness api={api} />);
  return { list, markRead, markAllRead, user: userEvent.setup() };
};

describe("NotificationBell", () => {
  it("counts only the unread ones in its name", async () => {
    setup([unread("n1"), aNotification({ id: "n2", readAt: "2026-11-10T09:00:00.000Z" })]);
    expect(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    ).toBeInTheDocument();
  });

  it("lists each message with the place that fixes it, and says when nothing is waiting", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(within(panel).getByRole("link", { name: /needs you to log in again/ })).toHaveAttribute(
      "href",
      "/suppliers/11111111-1111-4111-8111-111111111111/connect",
    );
    expect(within(panel).getByRole("link", { name: /pages changed/ })).toHaveAttribute(
      "href",
      "/suppliers/11111111-1111-4111-8111-111111111111/rules",
    );
  });

  it("reads one when its link is followed, and the count drops", async () => {
    const { user, markRead } = setup();
    await user.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    await user.click(screen.getByRole("link", { name: /pages changed/ }));
    expect(markRead).toHaveBeenCalledWith("n2");
    expect(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/suppliers/11111111-1111-4111-8111-111111111111/rules");
  });

  it("marks everything as read", async () => {
    const { user, markAllRead } = setup();
    await user.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(markAllRead).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("button", { name: "Notifications, none unread" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  });

  it("says all is well when there is nothing", async () => {
    const { user } = setup([]);
    await user.click(await screen.findByRole("button", { name: "Notifications, none unread" }));
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });

  it("puts a message back as unread if reading it could not be saved", async () => {
    const list = vi.fn().mockResolvedValue([unread("n1")]);
    const api = fakeApi({
      notifications: { list, markRead: vi.fn().mockRejectedValue(new Error("down")) },
    });
    renderWithStore(<Harness api={api} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await user.click(screen.getByRole("link", { name: /needs you to log in again/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    ).toBeInTheDocument();
  });

  it("says how to fix each kind, right in the message", async () => {
    const { user } = setup([
      unread("a"),
      unread("b", {
        kind: "recipe_needs_review",
        reason: "page_changed",
        message: "Acme Supply's pages changed. Review its stock rules.",
      }),
      unread("c", {
        kind: "proposal_needs_attention",
        reason: "unknown",
        message: "A suggestion for Acme Supply needs you.",
      }),
    ]);
    await user.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(
      within(panel).getByRole("link", { name: /needs you to log in again.*Log in again/ }),
    ).toHaveAttribute("href", "/suppliers/11111111-1111-4111-8111-111111111111/connect");
    expect(
      within(panel).getByRole("link", { name: /pages changed.*Review stock rules/ }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("link", { name: /needs you\..*See suggestions/ }),
    ).toHaveAttribute("href", "/proposals");
    expect(within(panel).getByText("Checks wait until you log in.")).toBeInTheDocument();
  });

  it("groups messages into Today and Earlier", async () => {
    const today = new Date().toISOString();
    const { user } = setup([
      unread("a", { createdAt: today }),
      aNotification({
        id: "b",
        readAt: today,
        createdAt: "2026-01-02T10:00:00.000Z",
        message: "Old news.",
      }),
    ]);
    await user.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    const groups = within(panel).getAllByRole("list");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Today", "Earlier"]);
    expect(within(groups[1]!).getByText("Old news.")).toBeInTheDocument();
  });

  it("shows only the unread ones under Unread", async () => {
    const { user } = setup([
      unread("a"),
      aNotification({ id: "b", readAt: "2026-11-10T09:00:00.000Z", message: "Old news." }),
    ]);
    await user.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(within(panel).getByText("Old news.")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Unread · 1" }));
    expect(within(panel).getByRole("button", { name: "Unread · 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(panel).queryByText("Old news.")).toBeNull();
    expect(within(panel).getByText(/needs you to log in again/)).toBeInTheDocument();
  });
});
