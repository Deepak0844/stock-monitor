// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { aCapture, aRecipeVersion, aSupplier, fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import { mappingKeys } from "../mappings/mappingApi.js";
import { supplierKeys } from "../suppliers/supplierApi.js";
import {
  captureKeys,
  useGetCaptureListQuery,
  useLabelCaptureMutation,
  useRemoveCaptureMutation,
  useRequestCaptureMutation,
} from "../captures/captureApi.js";
import {
  recipeKeys,
  useActivateRecipeMutation,
  useGetRecipeVersionsQuery,
  useRemoveRecipeMutation,
  useSaveRecipeMutation,
} from "./recipeApi.js";

afterEach(cleanup);

function Lists() {
  const captures = useGetCaptureListQuery("s1").data;
  const versions = useGetRecipeVersionsQuery("s1").data;
  return (
    <p>
      {captures ? `pages: ${captures.length}` : "pages: loading"}; {versions ? `versions: ${versions.length}` : "versions: loading"}
    </p>
  );
}
let request: ReturnType<typeof useRequestCaptureMutation> | undefined;
let label: ReturnType<typeof useLabelCaptureMutation> | undefined;
let removeCapture: ReturnType<typeof useRemoveCaptureMutation> | undefined;
let save: ReturnType<typeof useSaveRecipeMutation> | undefined;
let activate: ReturnType<typeof useActivateRecipeMutation> | undefined;
let removeRecipe: ReturnType<typeof useRemoveRecipeMutation> | undefined;
function Actions() {
  request = useRequestCaptureMutation();
  label = useLabelCaptureMutation();
  removeCapture = useRemoveCaptureMutation();
  save = useSaveRecipeMutation();
  activate = useActivateRecipeMutation();
  removeRecipe = useRemoveRecipeMutation();
  return null;
}

describe("stock rules in the cache", () => {
  it("reads the saved pages again after one is asked for, labelled or deleted", async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([aCapture({ id: "c1" })]).mockResolvedValue([aCapture({ id: "c1" }), aCapture({ id: "c2" })]);
    const { client } = renderWithStore(
      <>
        <Lists />
        <Actions />
      </>,
      { api: fakeApi({ captures: { list } }) },
    );
    await screen.findByText(/pages: 0/);
    await act(() => request!.mutateAsync({ supplierId: "s1", mappingId: "m1" }));
    expect(await screen.findByText(/pages: 1/)).toBeInTheDocument();
    client.setQueryData(captureKeys.detail("c1"), aCapture({ id: "c1" }) as never);
    await act(() => label!.mutateAsync({ supplierId: "s1", id: "c1", patch: { name: "Blue", expected: "in_stock" } }));
    expect(await screen.findByText(/pages: 2/)).toBeInTheDocument();
    expect(client.getQueryData<{ name: string }>(captureKeys.detail("c1"))?.name).toBe("Blue");
    await act(() => removeCapture!.mutateAsync({ supplierId: "s1", id: "c1" }));
    expect(client.getQueryState(captureKeys.detail("c1"))).toBeUndefined();
    expect(list).toHaveBeenCalledTimes(4);
  });

  it("reads the versions again after a save or delete", async () => {
    const versionList = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([aRecipeVersion({ id: "r1" })]).mockResolvedValue([]);
    renderWithStore(
      <>
        <Lists />
        <Actions />
      </>,
      { api: fakeApi({ recipes: { list: versionList } }) },
    );
    await screen.findByText(/versions: 0/);
    await act(() => save!.mutateAsync({ supplierId: "s1", recipe: aRecipeVersion().rules }));
    expect(await screen.findByText(/versions: 1/)).toBeInTheDocument();
    await act(() => removeRecipe!.mutateAsync({ supplierId: "s1", id: "r1" }));
    expect(await screen.findByText(/versions: 0/)).toBeInTheDocument();
  });

  it("after turning a version on, reads the versions again and marks the supplier and its links out of date", async () => {
    const { client } = renderWithStore(<Actions />, { api: fakeApi() });
    client.setQueryData(recipeKeys.versions("s1"), [aRecipeVersion({ id: "r1" })]);
    client.setQueryData(supplierKeys.detail("s1"), aSupplier({ id: "s1" }));
    client.setQueryData(mappingKeys.list({ supplierId: "s1" }), []);
    await act(() => activate!.mutateAsync({ supplierId: "s1", id: "r1" }));
    expect(client.getQueryState(recipeKeys.versions("s1"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(supplierKeys.detail("s1"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(mappingKeys.list({ supplierId: "s1" }))?.isInvalidated).toBe(true);
  });
});
