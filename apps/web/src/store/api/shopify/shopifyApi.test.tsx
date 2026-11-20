// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { aCheck, aConnection, fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import {
  shopifyKeys,
  useChooseShopifyLocationMutation,
  useConnectShopifyMutation,
  useDisconnectShopifyMutation,
  useGetShopifyConnectionQuery,
  useShopifyRefresh,
} from "./shopifyApi.js";

afterEach(cleanup);
const variants = { page: 1, pageSize: 25 };

function Connection({ name }: { name: string }) {
  const { data } = useGetShopifyConnectionQuery();
  return <p>{data === undefined ? `${name}: loading` : `${name}: ${data ? `${data.shop} at ${data.locationName ?? "no location"}` : "not connected"}`}</p>;
}
let connect: ReturnType<typeof useConnectShopifyMutation> | undefined;
let disconnect: ReturnType<typeof useDisconnectShopifyMutation> | undefined;
let choose: ReturnType<typeof useChooseShopifyLocationMutation> | undefined;
let refresh: ReturnType<typeof useShopifyRefresh> | undefined;
function Actions() {
  connect = useConnectShopifyMutation();
  disconnect = useDisconnectShopifyMutation();
  choose = useChooseShopifyLocationMutation();
  refresh = useShopifyRefresh();
  return null;
}

describe("Shopify in the cache", () => {
  it("asks the server once when Products and Settings both need the connection", async () => {
    const getConnection = vi.fn().mockResolvedValue(aConnection());
    renderWithStore(
      <>
        <Connection name="a" />
        <Connection name="b" />
      </>,
      { api: fakeApi({ shopify: { getConnection } }) },
    );
    expect(await screen.findByText("a: acme.myshopify.com at no location")).toBeInTheDocument();
    expect(screen.getByText("b: acme.myshopify.com at no location")).toBeInTheDocument();
    expect(getConnection).toHaveBeenCalledTimes(1);
  });

  it("shows a new connection at once, and an ended one as not connected", async () => {
    const api = fakeApi({
      shopify: {
        getConnection: vi.fn().mockResolvedValue(null),
        connect: vi.fn().mockResolvedValue({ connection: aConnection({ shop: "new.myshopify.com" }), ...aCheck() }),
      },
    });
    renderWithStore(
      <>
        <Connection name="a" />
        <Actions />
      </>,
      { api },
    );
    await screen.findByText("a: not connected");
    await act(() => connect!.mutateAsync({ shop: "new.myshopify.com" } as never));
    expect(await screen.findByText("a: new.myshopify.com at no location")).toBeInTheDocument();
    await act(() => disconnect!.mutateAsync());
    expect(await screen.findByText("a: not connected")).toBeInTheDocument();
  });

  it("shows a chosen location on the connection, and marks the products out of date", async () => {
    const api = fakeApi({
      shopify: { getConnection: vi.fn().mockResolvedValue(aConnection()), chooseLocation: vi.fn().mockResolvedValue({ id: "l2", name: "Warehouse" }) },
    });
    const { client } = renderWithStore(
      <>
        <Connection name="a" />
        <Actions />
      </>,
      { api },
    );
    await screen.findByText("a: acme.myshopify.com at no location");
    client.setQueryData(shopifyKeys.variants(variants), { items: [], total: 0, page: 1, pageSize: 25 });
    await act(() => choose!.mutateAsync("l2"));
    expect(await screen.findByText("a: acme.myshopify.com at Warehouse")).toBeInTheDocument();
    expect(client.getQueryState(shopifyKeys.variants(variants))?.isInvalidated).toBe(true);
  });

  it("after a sync, reads the connection and the products again", async () => {
    const getConnection = vi.fn().mockResolvedValue(aConnection());
    const { client } = renderWithStore(
      <>
        <Connection name="a" />
        <Actions />
      </>,
      { api: fakeApi({ shopify: { getConnection } }) },
    );
    await screen.findByText("a: acme.myshopify.com at no location");
    client.setQueryData(shopifyKeys.variants(variants), { items: [], total: 0, page: 1, pageSize: 25 });
    act(() => refresh!());
    await vi.waitFor(() => expect(getConnection).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(shopifyKeys.variants(variants))?.isInvalidated).toBe(true);
  });
});
