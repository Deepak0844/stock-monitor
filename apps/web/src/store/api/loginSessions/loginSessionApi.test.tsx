// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { aLoginSession, aSupplier, fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import { supplierKeys } from "../suppliers/supplierApi.js";
import { useCancelLoginMutation, useFinishLoginMutation, useStartLoginMutation } from "./loginSessionApi.js";

afterEach(cleanup);
let start: ReturnType<typeof useStartLoginMutation> | undefined;
let finish: ReturnType<typeof useFinishLoginMutation> | undefined;
let cancel: ReturnType<typeof useCancelLoginMutation> | undefined;
function Actions() {
  start = useStartLoginMutation();
  finish = useFinishLoginMutation();
  cancel = useCancelLoginMutation();
  return null;
}

describe("login windows", () => {
  it("opens and closes a login window for a supplier", async () => {
    const api = fakeApi();
    renderWithStore(<Actions />, { api });
    await act(() => start!.mutateAsync("s1"));
    expect(api.loginSessions.start).toHaveBeenCalledWith("s1");
    await act(() => cancel!.mutateAsync("l1"));
    expect(api.loginSessions.cancel).toHaveBeenCalledWith("l1");
  });

  it("after the login is saved, reads the supplier again and marks the supplier lists out of date", async () => {
    const api = fakeApi({ loginSessions: { finish: vi.fn().mockResolvedValue({ loginSession: aLoginSession(), session: null }) } });
    const { client } = renderWithStore(<Actions />, { api });
    client.setQueryData(supplierKeys.detail("s1"), aSupplier({ id: "s1" }));
    client.setQueryData(supplierKeys.list(), [aSupplier({ id: "s1" })]);
    await act(() => finish!.mutateAsync({ supplierId: "s1", id: "l1" }));
    expect(api.loginSessions.finish).toHaveBeenCalledWith("l1");
    expect(client.getQueryState(supplierKeys.detail("s1"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(supplierKeys.list())?.isInvalidated).toBe(true);
  });
});
