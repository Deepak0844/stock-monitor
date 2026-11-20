// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Api } from "../../../api.js";
import { StoreProvider } from "../../StoreProvider.js";
import { createQueryClient } from "../api.js";
import { fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import { proposalKeys, useGetProposalSettingsQuery, useSaveProposalSettingsMutation } from "./proposalApi.js";

afterEach(cleanup);
const ready = { state: "ready" as const, message: "Shopify allows this app to change stock." };
const answer = { settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: ready };

function Reader({ name }: { name: string }) {
  const { data } = useGetProposalSettingsQuery();
  return <p>{data ? `${name}: ${data.settings.defaultQuantity}` : `${name}: loading`}</p>;
}

let save: ReturnType<typeof useSaveProposalSettingsMutation> | undefined;
function Saver() {
  save = useSaveProposalSettingsMutation();
  return null;
}

describe("proposal settings queries", () => {
  it("asks the server once when two components need the settings", async () => {
    const settings = vi.fn().mockResolvedValue(answer);
    renderWithStore(
      <>
        <Reader name="a" />
        <Reader name="b" />
      </>,
      { api: fakeApi({ proposals: { settings } }) },
    );
    expect(await screen.findByText("a: 5")).toBeInTheDocument();
    expect(screen.getByText("b: 5")).toBeInTheDocument();
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it("puts the server's answer to a save into the cache, so readers update without a new request", async () => {
    const settings = vi.fn().mockResolvedValue(answer);
    const saved = { settings: { defaultQuantity: 8, expiryHours: 12 }, writePermission: ready };
    const { client } = renderWithStore(
      <>
        <Reader name="a" />
        <Saver />
      </>,
      { api: fakeApi({ proposals: { settings, saveSettings: vi.fn().mockResolvedValue(saved) } }) },
    );
    await screen.findByText("a: 5");
    await act(() => save!.mutateAsync({ defaultQuantity: 8, expiryHours: 12 }));
    expect(await screen.findByText("a: 8")).toBeInTheDocument();
    expect(client.getQueryData(proposalKeys.settings())).toEqual(saved);
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it("reads the cache with no new request when the page is opened again within 30 seconds", async () => {
    const settings = vi.fn().mockResolvedValue(answer);
    const api: Api = fakeApi({ proposals: { settings } });
    // The app's own client, so its 30-second freshness is what is tested.
    const client = createQueryClient();
    const page = () => (
      <StoreProvider api={api} client={client}>
        <Reader name="a" />
      </StoreProvider>
    );
    const first = render(page());
    await screen.findByText("a: 5");
    first.unmount();
    render(page());
    expect(screen.getByText("a: 5")).toBeInTheDocument();
    expect(settings).toHaveBeenCalledTimes(1);
  });
});
