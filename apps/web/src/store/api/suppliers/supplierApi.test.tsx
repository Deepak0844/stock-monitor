// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { aSupplier, fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import {
  supplierKeys,
  useCreateSupplierMutation,
  useGetSupplierListQuery,
  useGetSupplierPageQuery,
  useGetSupplierQuery,
  useRemoveSupplierMutation,
  useSetSupplierEnabledMutation,
  useSupplierRefresh,
} from "./supplierApi.js";

afterEach(cleanup);
const acme = aSupplier({ id: "s1", name: "Acme" });
const bolt = aSupplier({ id: "s2", name: "Bolt" });
const pageQuery = { page: 1, pageSize: 10 };

function List({ name }: { name: string }) {
  const { data } = useGetSupplierListQuery();
  return <p>{data ? `${name}: ${data.map((s) => `${s.name}=${s.enabled ? "on" : "off"}`).join(",") || "none"}` : `${name}: loading`}</p>;
}
function PageOf() {
  const { data } = useGetSupplierPageQuery(pageQuery);
  return <p>{data ? `page: ${data.items.map((s) => `${s.name}=${s.enabled ? "on" : "off"}`).join(",") || "none"} of ${data.total}` : "page: loading"}</p>;
}
function One() {
  const { data } = useGetSupplierQuery("s1");
  return <p>{data ? `one: ${data.name}=${data.enabled ? "on" : "off"}` : "one: loading"}</p>;
}
let enabled: ReturnType<typeof useSetSupplierEnabledMutation> | undefined;
let remove: ReturnType<typeof useRemoveSupplierMutation> | undefined;
let create: ReturnType<typeof useCreateSupplierMutation> | undefined;
let refresh: ReturnType<typeof useSupplierRefresh> | undefined;
function Actions() {
  enabled = useSetSupplierEnabledMutation();
  remove = useRemoveSupplierMutation();
  create = useCreateSupplierMutation();
  refresh = useSupplierRefresh();
  return null;
}

describe("suppliers in the cache", () => {
  it("asks the server once when several pages need every supplier", async () => {
    const list = vi.fn().mockResolvedValue([acme, bolt]);
    renderWithStore(
      <>
        <List name="a" />
        <List name="b" />
      </>,
      { api: fakeApi({ suppliers: { list } }) },
    );
    expect(await screen.findByText("a: Acme=on,Bolt=on")).toBeInTheDocument();
    expect(screen.getByText("b: Acme=on,Bolt=on")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("shows a paused supplier as paused everywhere it is cached", async () => {
    const paused = { ...acme, enabled: false };
    const api = fakeApi({
      suppliers: {
        list: vi.fn().mockResolvedValue([acme, bolt]),
        page: vi.fn().mockResolvedValue({ items: [acme, bolt], total: 2, page: 1, pageSize: 10 }),
        get: vi.fn().mockResolvedValue(acme),
        pause: vi.fn().mockResolvedValue(paused),
      },
    });
    renderWithStore(
      <>
        <List name="a" />
        <PageOf />
        <One />
        <Actions />
      </>,
      { api },
    );
    await screen.findByText("one: Acme=on");
    await screen.findByText("page: Acme=on,Bolt=on of 2");
    await act(() => enabled!.mutateAsync({ supplier: acme, enabled: false }));
    expect(await screen.findByText("a: Acme=off,Bolt=on")).toBeInTheDocument();
    expect(screen.getByText("page: Acme=off,Bolt=on of 2")).toBeInTheDocument();
    expect(screen.getByText("one: Acme=off")).toBeInTheDocument();
    expect(api.suppliers.pause).toHaveBeenCalledWith("s1");
  });

  it("resumes a paused supplier", async () => {
    const api = fakeApi({ suppliers: { resume: vi.fn().mockResolvedValue(acme) } });
    renderWithStore(<Actions />, { api });
    await act(() => enabled!.mutateAsync({ supplier: { ...acme, enabled: false }, enabled: true }));
    expect(api.suppliers.resume).toHaveBeenCalledWith("s1");
  });

  it("takes a deleted supplier out of the list and reads the page again", async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ items: [acme, bolt], total: 2, page: 1, pageSize: 10 })
      .mockResolvedValue({ items: [bolt], total: 1, page: 1, pageSize: 10 });
    renderWithStore(
      <>
        <List name="a" />
        <PageOf />
        <Actions />
      </>,
      { api: fakeApi({ suppliers: { list: vi.fn().mockResolvedValueOnce([acme, bolt]).mockResolvedValue([bolt]), page } }) },
    );
    await screen.findByText("page: Acme=on,Bolt=on of 2");
    await act(() => remove!.mutateAsync({ id: "s1" }));
    expect(await screen.findByText("a: Bolt=on")).toBeInTheDocument();
    expect(await screen.findByText("page: Bolt=on of 1")).toBeInTheDocument();
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("marks every supplier list out of date when one is added", async () => {
    const { client } = renderWithStore(<Actions />, { api: fakeApi() });
    client.setQueryData(supplierKeys.list(), [bolt]);
    await act(() => create!.mutateAsync({ name: "New", websiteUrl: "https://new.example/" } as never));
    expect(client.getQueryState(supplierKeys.list())?.isInvalidated).toBe(true);
  });

  it("reads one supplier again after a card changed it, and marks the lists out of date", async () => {
    const get = vi.fn().mockResolvedValueOnce(acme).mockResolvedValue({ ...acme, name: "Acme Ltd" });
    const { client } = renderWithStore(
      <>
        <One />
        <Actions />
      </>,
      { api: fakeApi({ suppliers: { get } }) },
    );
    await screen.findByText("one: Acme=on");
    client.setQueryData(supplierKeys.list(), [acme]);
    act(() => refresh!("s1"));
    expect(await screen.findByText("one: Acme Ltd=on")).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryState(supplierKeys.list())?.isInvalidated).toBe(true));
  });
});
