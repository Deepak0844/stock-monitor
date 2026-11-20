// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { aSupplier, fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import { supplierKeys } from "../suppliers/supplierApi.js";
import { authKeys, useGetMeQuery, useLoginMutation, useLogoutMutation } from "./authApi.js";

afterEach(cleanup);
function Me() {
  const { data, isError } = useGetMeQuery();
  return <p>{isError ? "me: error" : data === undefined ? "me: loading" : data ? `me: ${data.email}` : "me: nobody"}</p>;
}
let login: ReturnType<typeof useLoginMutation> | undefined;
let logout: ReturnType<typeof useLogoutMutation> | undefined;
function Actions() {
  login = useLoginMutation();
  logout = useLogoutMutation();
  return null;
}

describe("signing in and out", () => {
  it("says at once when the session cannot be checked, without trying again", async () => {
    const getMe = vi.fn().mockRejectedValue(new Error("offline"));
    renderWithStore(<Me />, { api: fakeApi({ getMe }) });
    expect(await screen.findByText("me: error")).toBeInTheDocument();
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("shows the owner once signed in", async () => {
    const api = fakeApi({ getMe: vi.fn().mockResolvedValue(null), login: vi.fn().mockResolvedValue({ email: "owner@example.com" }) });
    renderWithStore(
      <>
        <Me />
        <Actions />
      </>,
      { api },
    );
    await screen.findByText("me: nobody");
    await act(() => login!.mutateAsync({ email: "owner@example.com", password: "pw" }));
    expect(await screen.findByText("me: owner@example.com")).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith("owner@example.com", "pw");
  });

  it("after signing out, keeps nothing from the session and shows nobody signed in", async () => {
    const api = fakeApi({ getMe: vi.fn().mockResolvedValue({ email: "owner@example.com" }) });
    const { client } = renderWithStore(
      <>
        <Me />
        <Actions />
      </>,
      { api },
    );
    await screen.findByText("me: owner@example.com");
    client.setQueryData(supplierKeys.list(), [aSupplier()]);
    await act(() => logout!.mutateAsync());
    expect(await screen.findByText("me: nobody")).toBeInTheDocument();
    expect(client.getQueryData(supplierKeys.list())).toBeUndefined();
    expect(client.getQueryData(authKeys.me())).toBeNull();
  });
});
