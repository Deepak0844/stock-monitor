// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { fakeApi } from "../test/fake-api.js";
import { renderWithQuery } from "../test/renderWithQuery.js";
import { queryKeys } from "./keys.js";
import { useProposalSettings, useSaveProposalSettings } from "./proposals.js";

afterEach(cleanup);
const ready = { state: "ready" as const, message: "Shopify allows this app to change stock." };
const answer = { settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: ready };

function Reader({ name }: { name: string }) {
  const { data } = useProposalSettings();
  return <p>{data ? `${name}: ${data.settings.defaultQuantity}` : `${name}: loading`}</p>;
}

let save: ReturnType<typeof useSaveProposalSettings> | undefined;
function Saver() {
  save = useSaveProposalSettings();
  return null;
}

describe("proposal settings queries", () => {
  it("asks the server once when two components need the settings", async () => {
    const settings = vi.fn().mockResolvedValue(answer);
    renderWithQuery(
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
    const { client } = renderWithQuery(
      <>
        <Reader name="a" />
        <Saver />
      </>,
      { api: fakeApi({ proposals: { settings, saveSettings: vi.fn().mockResolvedValue(saved) } }) },
    );
    await screen.findByText("a: 5");
    await act(() => save!.mutateAsync({ defaultQuantity: 8, expiryHours: 12 }));
    expect(await screen.findByText("a: 8")).toBeInTheDocument();
    expect(client.getQueryData(queryKeys.proposals.settings())).toEqual(saved);
    expect(settings).toHaveBeenCalledTimes(1);
  });
});
