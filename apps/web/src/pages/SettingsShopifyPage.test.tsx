// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError, type ShopifyApi, type SyncRun } from "../api.js";
import { aCheck, aConnection, fakeApi } from "../test/fake-api.js";
import { SettingsShopifyPage } from "./SettingsShopifyPage.js";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const run = (over: Partial<SyncRun> = {}): SyncRun => ({
  id: 1,
  startedAt: "2026-11-08T10:00:00.000Z",
  finishedAt: "2026-11-08T10:01:00.000Z",
  status: "succeeded",
  added: 3,
  updated: 2,
  unchanged: 5,
  removed: 1,
  total: 10,
  error: null,
  ...over,
});

const locations = [
  { id: "gid://shopify/Location/1", name: "Shop floor" },
  { id: "gid://shopify/Location/2", name: "Back room" },
];

const setup = (shopify: Partial<ShopifyApi> = {}) => {
  const api = fakeApi({ shopify });
  render(<SettingsShopifyPage api={api} />);
  return { api, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) };
};

const connected = (over: Parameters<typeof aConnection>[0] = {}, extra: Partial<ShopifyApi> = {}) => ({
  getConnection: vi.fn().mockResolvedValue(aConnection(over)),
  locations: vi.fn().mockResolvedValue(locations),
  ...extra,
});

describe("loading", () => {
  it("says it is loading, then shows the page heading", async () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(await screen.findByRole("heading", { level: 1, name: "Shopify settings" })).toBeInTheDocument();
  });

  it("explains a failure plainly and offers to try again", async () => {
    const getConnection = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0)).mockResolvedValue(null);
    const { user } = setup({ getConnection });
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Connect your Shopify store" })).toBeInTheDocument();
  });
});

describe("not connected yet", () => {
  it("invites the owner to connect and promises it only reads", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 2, name: "Connect your Shopify store" })).toBeInTheDocument();
    expect(screen.getByText(/never changes anything in shopify/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Store address")).toBeInTheDocument();
  });

  it("connects, then shows the connection with a welcome and any warnings", async () => {
    const warning = "This connection can change your store (write_inventory). This app only needs to read, so for extra safety remove the write permissions in Shopify.";
    const connect = vi.fn().mockResolvedValue({ connection: aConnection(), ...aCheck({ warnings: [warning] }) });
    const { user } = setup({ connect, getConnection: vi.fn().mockResolvedValue(null), locations: vi.fn().mockResolvedValue(locations) });
    await user.type(await screen.findByLabelText("Store address"), "acme.myshopify.com");
    await user.type(screen.getByLabelText("Client ID"), "id");
    await user.type(screen.getByLabelText("Client secret"), "secret");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Connected to Acme Supplies.")).toBeInTheDocument();
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connection" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Client secret")).not.toBeInTheDocument();
  });
});

describe("the connection", () => {
  it("shows the store, its status, the permissions and when it was last used", async () => {
    setup(connected({ lastSuccessfulCallAt: null }));
    const section = (await screen.findByRole("heading", { name: "Connection" })).closest("section")!;
    expect(within(section).getByText("acme.myshopify.com")).toBeInTheDocument();
    expect(within(section).getByText("Connected")).toBeInTheDocument();
    expect(within(section).getByText("read_products")).toBeInTheDocument();
    expect(within(section).getByText("read_inventory")).toBeInTheDocument();
    expect(within(section).getByText("Not yet")).toBeInTheDocument();
  });

  it("says when the permissions are not known", async () => {
    setup(connected({ scopes: [] }));
    expect(await screen.findByText(/not checked/i)).toBeInTheDocument();
  });

  it("tests the saved connection without sending any details", async () => {
    const test = vi.fn().mockResolvedValue(aCheck());
    const { user } = setup(connected({}, { test }));
    await user.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(test).toHaveBeenCalledWith();
    expect(await screen.findByText(/connection works/i)).toBeInTheDocument();
  });

  it("tells the owner to reconnect, and opens the form with only the store address filled in", async () => {
    const { user, api } = setup(connected({ status: "needs_reconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Shopify rejected the saved connection. Reconnect Shopify.");
    expect(screen.getByText("Needs reconnecting")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reconnect Shopify" }));
    expect(screen.getByLabelText("Store address")).toHaveValue("acme.myshopify.com");
    expect(screen.getByLabelText("Client secret")).toHaveValue("");
    expect(api.shopify.locations).not.toHaveBeenCalled(); // a connection that needs reconnecting is not asked for locations
  });

  it("reconnects, closes the form, and shows the fresh status", async () => {
    const getConnection = vi.fn().mockResolvedValueOnce(aConnection({ status: "needs_reconnect" }));
    const connect = vi.fn().mockResolvedValue({ connection: aConnection({ status: "connected" }), ...aCheck() });
    const { user } = setup({ getConnection, connect, locations: vi.fn().mockResolvedValue(locations) });
    await user.click(await screen.findByRole("button", { name: "Reconnect Shopify" }));
    await user.type(screen.getByLabelText("Client ID"), "id");
    await user.type(screen.getByLabelText("Client secret"), "secret");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Client secret")).not.toBeInTheDocument();
  });

  it("asks before disconnecting, and says what will happen", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const { user } = setup(connected({}, { disconnect }));
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(screen.getByText(/the saved credentials will be deleted/i)).toBeInTheDocument();
    expect(disconnect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/the saved credentials will be deleted/i)).not.toBeInTheDocument();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("disconnects after confirmation and returns to the connect form", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const { user } = setup(connected({}, { disconnect }));
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Connect your Shopify store" })).toBeInTheDocument();
  });

  it("shows a plain error when disconnecting fails and stays connected", async () => {
    const disconnect = vi.fn().mockRejectedValue(new ApiError("Something went wrong. Please try again.", 500));
    const { user } = setup(connected({}, { disconnect }));
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.getByRole("heading", { name: "Connection" })).toBeInTheDocument();
  });
});

describe("inventory location", () => {
  it("offers the active locations and asks the owner to choose when none is saved", async () => {
    setup(connected());
    const select = await screen.findByLabelText("Location");
    expect(within(select).getByRole("option", { name: "Choose a location" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Shop floor" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Back room" })).toBeInTheDocument();
  });

  it("shows the saved location as selected", async () => {
    setup(connected({ locationId: "gid://shopify/Location/2", locationName: "Back room" }));
    expect(await screen.findByLabelText("Location")).toHaveValue("gid://shopify/Location/2");
  });

  it("saves a choice straight away and confirms it", async () => {
    const chooseLocation = vi.fn().mockResolvedValue(locations[1]);
    const { user } = setup(connected({}, { chooseLocation }));
    await user.selectOptions(await screen.findByLabelText("Location"), "Back room");
    expect(chooseLocation).toHaveBeenCalledWith("gid://shopify/Location/2");
    expect(await screen.findByText("Using Back room.")).toBeInTheDocument();
  });

  it("explains a failure and keeps the old choice", async () => {
    const chooseLocation = vi.fn().mockRejectedValue(new ApiError("That location is not available in Shopify. Choose one from the list.", 400, "invalid_location"));
    const { user } = setup(connected({ locationId: "gid://shopify/Location/1", locationName: "Shop floor" }, { chooseLocation }));
    await user.selectOptions(await screen.findByLabelText("Location"), "Back room");
    expect(await screen.findByRole("alert")).toHaveTextContent("That location is not available in Shopify.");
    expect(screen.getByLabelText("Location")).toHaveValue("gid://shopify/Location/1");
  });

  it("says so when Shopify has no active locations", async () => {
    setup(connected({}, { locations: vi.fn().mockResolvedValue([]) }));
    expect(await screen.findByText(/no active locations/i)).toBeInTheDocument();
  });

  it("explains a failure to load the locations", async () => {
    setup(connected({}, { locations: vi.fn().mockRejectedValue(new ApiError("Can't reach Shopify right now. Try again in a few minutes.", 503, "shopify_unreachable")) }));
    expect(await screen.findByText("Can't reach Shopify right now. Try again in a few minutes.")).toBeInTheDocument();
  });
});

describe("sync", () => {
  const ready = { locationId: "gid://shopify/Location/1", locationName: "Shop floor" } as const;

  it("is not available until a location is chosen, and says why", async () => {
    setup(connected());
    const button = await screen.findByRole("button", { name: "Sync from Shopify" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Choose an inventory location first.")).toBeInTheDocument();
  });

  it("shows the last sync without being asked", async () => {
    setup(connected(ready, { getSync: vi.fn().mockResolvedValue(run()) }));
    expect(await screen.findByText(/10 variants/)).toBeInTheDocument();
    expect(screen.getByText(/3 new/)).toBeInTheDocument();
    expect(screen.getByText(/2 updated/)).toBeInTheDocument();
    expect(screen.getByText(/1 removed/)).toBeInTheDocument();
  });

  it("says when nothing has been synced yet", async () => {
    setup(connected(ready));
    expect(await screen.findByText("Nothing has been synced yet.")).toBeInTheDocument();
  });

  it("shows a failed sync's reason in plain words", async () => {
    setup(connected(ready, { getSync: vi.fn().mockResolvedValue(run({ status: "failed", error: "Can't reach Shopify right now. Try again in a few minutes.", total: null })) }));
    expect(await screen.findByText("Can't reach Shopify right now. Try again in a few minutes.")).toBeInTheDocument();
  });

  it("starts a sync, shows live progress, and shows the result when it finishes", async () => {
    const getSync = vi
      .fn()
      .mockResolvedValueOnce(null) // on load
      .mockResolvedValueOnce(run({ id: 7, status: "running", finishedAt: null, total: 50, added: null, updated: null, unchanged: null, removed: null }))
      .mockResolvedValueOnce(run({ id: 7, status: "running", finishedAt: null, total: 100, added: null, updated: null, unchanged: null, removed: null }))
      .mockResolvedValue(run({ id: 7, total: 120, added: 120, updated: 0, unchanged: 0, removed: 0 }));
    const startSync = vi.fn().mockResolvedValue(undefined);
    const { user, api } = setup(connected(ready, { getSync, startSync }));
    await user.click(await screen.findByRole("button", { name: "Sync from Shopify" }));
    expect(startSync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(await screen.findByText(/50 variants so far/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(await screen.findByText(/100 variants so far/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(await screen.findByText(/120 variants/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync from Shopify" })).toBeEnabled();
    // after a sync, the connection is read again, because its status may have changed
    expect(vi.mocked(api.shopify.getConnection).mock.calls.length).toBeGreaterThan(1);
  });

  it("does not mistake the previous run for the new one", async () => {
    const getSync = vi.fn().mockResolvedValue(run({ id: 4 })); // always the old run
    const { user } = setup(connected(ready, { getSync }));
    await user.click(await screen.findByRole("button", { name: "Sync from Shopify" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
    expect(screen.getByRole("status", { name: /sync/i })).toHaveTextContent(/starting/i);
  });

  it("says the worker may not be running when the sync never starts", async () => {
    const getSync = vi.fn().mockResolvedValue(run({ id: 4 }));
    const { user } = setup(connected(ready, { getSync }));
    await user.click(await screen.findByRole("button", { name: "Sync from Shopify" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000 * 16); });
    expect(await screen.findByText(/has not started/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync from Shopify" })).toBeEnabled();
  });

  it("shows the server's plain message when a sync cannot be started", async () => {
    const startSync = vi.fn().mockRejectedValue(new ApiError("A sync is already running.", 409, "sync_running"));
    const { user } = setup(connected(ready, { startSync }));
    await user.click(await screen.findByRole("button", { name: "Sync from Shopify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A sync is already running.");
  });

  it("picks up a sync that is already running when the page opens", async () => {
    const getSync = vi.fn().mockResolvedValueOnce(run({ id: 9, status: "running", finishedAt: null, total: 30 })).mockResolvedValue(run({ id: 9, total: 60 }));
    setup(connected(ready, { getSync }));
    expect(await screen.findByText(/30 variants so far/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(await screen.findByText(/60 variants/)).toBeInTheDocument();
  });

  it("is not available while the connection needs reconnecting", async () => {
    setup(connected({ ...ready, status: "needs_reconnect" }));
    await screen.findByText("Needs reconnecting");
    expect(screen.getByRole("button", { name: "Sync from Shopify" })).toBeDisabled();
    expect(screen.getByText("Reconnect Shopify first.")).toBeInTheDocument();
  });
});
