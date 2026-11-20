// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { aMapping, fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import { shopifyKeys } from "../shopify/shopifyApi.js";
import {
  mappingKeys,
  useCreateMappingMutation,
  useGetMappingPageQuery,
  useGetMappingQuery,
  useGetUnmappedQuery,
  useMappingChanged,
  useRemoveMappingMutation,
  useUpdateMappingMutation,
} from "./mappingApi.js";

afterEach(cleanup);
const a = aMapping({ id: "m1", url: "https://a.example/1" });
const b = aMapping({ id: "m2", url: "https://a.example/2" });
const pageQuery = { page: 1, pageSize: 10 };
const variantsPage = shopifyKeys.variants({ page: 1, pageSize: 25 });

function PageOf() {
  const { data } = useGetMappingPageQuery(pageQuery);
  return <p>{data ? `page: ${data.items.map((m) => m.url).join(",") || "none"} of ${data.total}` : "page: loading"}</p>;
}
function One() {
  const { data } = useGetMappingQuery("m1");
  return <p>{data ? `one: ${data.url}` : "one: loading"}</p>;
}
function Unmapped({ name }: { name: string }) {
  const { data } = useGetUnmappedQuery();
  return <p>{data ? `${name}: ${data.unmapped} unmapped` : `${name}: loading`}</p>;
}
let create: ReturnType<typeof useCreateMappingMutation> | undefined;
let update: ReturnType<typeof useUpdateMappingMutation> | undefined;
let remove: ReturnType<typeof useRemoveMappingMutation> | undefined;
let changed: ReturnType<typeof useMappingChanged> | undefined;
function Actions() {
  create = useCreateMappingMutation();
  update = useUpdateMappingMutation();
  remove = useRemoveMappingMutation();
  changed = useMappingChanged();
  return null;
}

describe("links in the cache", () => {
  it("asks once for the variants without a link when the Dashboard and the form both need them", async () => {
    const unmapped = vi.fn().mockResolvedValue({ total: 5, unmapped: 2, items: [] });
    renderWithStore(
      <>
        <Unmapped name="a" />
        <Unmapped name="b" />
      </>,
      { api: fakeApi({ mappings: { unmapped } }) },
    );
    expect(await screen.findByText("a: 2 unmapped")).toBeInTheDocument();
    expect(screen.getByText("b: 2 unmapped")).toBeInTheDocument();
    expect(unmapped).toHaveBeenCalledTimes(1);
  });

  it("shows a link read after a finished check, or a saved change, wherever it is cached", async () => {
    const api = fakeApi({
      mappings: {
        page: vi.fn().mockResolvedValue({ items: [a, b], total: 2, page: 1, pageSize: 10 }),
        get: vi.fn().mockResolvedValue(a),
        update: vi.fn().mockResolvedValue({ ...a, url: "https://a.example/saved" }),
      },
    });
    renderWithStore(
      <>
        <PageOf />
        <One />
        <Actions />
      </>,
      { api },
    );
    await screen.findByText("one: https://a.example/1");
    await screen.findByText("page: https://a.example/1,https://a.example/2 of 2");
    act(() => changed!({ ...a, url: "https://a.example/checked" }));
    expect(await screen.findByText("page: https://a.example/checked,https://a.example/2 of 2")).toBeInTheDocument();
    expect(screen.getByText("one: https://a.example/checked")).toBeInTheDocument();
    await act(() => update!.mutateAsync({ id: "m1", patch: { url: "https://a.example/saved" } }));
    expect(await screen.findByText("one: https://a.example/saved")).toBeInTheDocument();
  });

  it("after a delete, reads the page and the variants without a link again, and marks Products out of date", async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ items: [a, b], total: 2, page: 1, pageSize: 10 })
      .mockResolvedValue({ items: [b], total: 1, page: 1, pageSize: 10 });
    const unmapped = vi.fn().mockResolvedValueOnce({ total: 5, unmapped: 2, items: [] }).mockResolvedValue({ total: 5, unmapped: 3, items: [] });
    const { client } = renderWithStore(
      <>
        <PageOf />
        <Unmapped name="a" />
        <Actions />
      </>,
      { api: fakeApi({ mappings: { page, unmapped } }) },
    );
    await screen.findByText("page: https://a.example/1,https://a.example/2 of 2");
    await screen.findByText("a: 2 unmapped");
    client.setQueryData(variantsPage, { items: [], total: 0, page: 1, pageSize: 25 });
    await act(() => remove!.mutateAsync({ id: "m1" }));
    expect(await screen.findByText("page: https://a.example/2 of 1")).toBeInTheDocument();
    expect(await screen.findByText("a: 3 unmapped")).toBeInTheDocument();
    expect(client.getQueryState(mappingKeys.detail("m1"))).toBeUndefined();
    expect(client.getQueryState(variantsPage)?.isInvalidated).toBe(true);
  });

  it("after adding a link, marks the links, the variants without one and Products out of date", async () => {
    const { client } = renderWithStore(<Actions />, { api: fakeApi() });
    client.setQueryData(mappingKeys.page(pageQuery), { items: [], total: 0, page: 1, pageSize: 10 });
    client.setQueryData(mappingKeys.unmapped(), { total: 1, unmapped: 1, items: [] });
    client.setQueryData(variantsPage, { items: [], total: 0, page: 1, pageSize: 25 });
    await act(() => create!.mutateAsync({ variantId: "v1", supplierId: "s1", url: "https://a.example/new" }));
    expect(client.getQueryState(mappingKeys.page(pageQuery))?.isInvalidated).toBe(true);
    expect(client.getQueryState(mappingKeys.unmapped())?.isInvalidated).toBe(true);
    expect(client.getQueryState(variantsPage)?.isInvalidated).toBe(true);
  });
});
