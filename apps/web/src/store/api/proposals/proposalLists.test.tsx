// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import type { Proposal } from "../../../api.js";
import { aProposal, fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import {
  proposalKeys,
  useApproveProposalMutation,
  useGetProposalCountQuery,
  useGetProposalOpenListQuery,
  useRejectProposalMutation,
} from "./proposalApi.js";

afterEach(cleanup);
const ready = { state: "ready" as const, message: "Shopify allows this app to change stock." };
const pageOf = (items: Proposal[], total = items.length) => ({ items, total, page: 1, pageSize: 10, writePermission: ready });
const query = { page: 1, pageSize: 10 };

function OpenList({ name }: { name: string }) {
  const { data } = useGetProposalOpenListQuery(query);
  return <p>{data ? `${name}: ${data.items.map((p) => `${p.id}=${p.state}`).join(",") || "none"} of ${data.total}` : `${name}: loading`}</p>;
}
function Count() {
  const { data } = useGetProposalCountQuery();
  return <p>count: {data ?? "?"}</p>;
}
let approve: ReturnType<typeof useApproveProposalMutation> | undefined;
let reject: ReturnType<typeof useRejectProposalMutation> | undefined;
function Actions() {
  approve = useApproveProposalMutation();
  reject = useRejectProposalMutation();
  return null;
}

describe("proposal lists in the cache", () => {
  it("asks the server once when two components show the same list", async () => {
    const openPage = vi.fn().mockResolvedValue(pageOf([aProposal()]));
    renderWithStore(
      <>
        <OpenList name="a" />
        <OpenList name="b" />
      </>,
      { api: fakeApi({ proposals: { openPage } }) },
    );
    expect(await screen.findByText("a: p1=open of 1")).toBeInTheDocument();
    expect(screen.getByText("b: p1=open of 1")).toBeInTheDocument();
    expect(openPage).toHaveBeenCalledTimes(1);
  });

  it("puts an approved suggestion into every cached list, so another page shows it approved", async () => {
    const openPage = vi.fn().mockResolvedValue(pageOf([aProposal()]));
    const approved = aProposal({ state: "approved" });
    renderWithStore(
      <>
        <OpenList name="a" />
        <Actions />
      </>,
      { api: fakeApi({ proposals: { openPage, approve: vi.fn().mockResolvedValue(approved) } }) },
    );
    await screen.findByText("a: p1=open of 1");
    await act(() => approve!.mutateAsync({ id: "p1" }));
    expect(await screen.findByText("a: p1=approved of 1")).toBeInTheDocument();
  });

  it("takes a rejected suggestion out of the list and lowers the total", async () => {
    const openPage = vi.fn().mockResolvedValue(pageOf([aProposal(), aProposal({ id: "p2" })]));
    renderWithStore(
      <>
        <OpenList name="a" />
        <Actions />
      </>,
      { api: fakeApi({ proposals: { openPage, reject: vi.fn().mockResolvedValue(aProposal({ state: "rejected" })) } }) },
    );
    await screen.findByText("a: p1=open,p2=open of 2");
    await act(() => reject!.mutateAsync({ id: "p1" }));
    expect(await screen.findByText("a: p2=open of 1")).toBeInTheDocument();
  });

  it("reads a list once more when its last row was decided and more are waiting", async () => {
    const openPage = vi.fn().mockResolvedValueOnce(pageOf([aProposal()], 3)).mockResolvedValue(pageOf([aProposal({ id: "p2" }), aProposal({ id: "p3" })]));
    renderWithStore(
      <>
        <OpenList name="a" />
        <Actions />
      </>,
      { api: fakeApi({ proposals: { openPage, reject: vi.fn().mockResolvedValue(aProposal({ state: "rejected" })) } }) },
    );
    await screen.findByText("a: p1=open of 3");
    await act(() => reject!.mutateAsync({ id: "p1" }));
    expect(await screen.findByText("a: p2=open,p3=open of 2")).toBeInTheDocument();
    expect(openPage).toHaveBeenCalledTimes(2);
  });

  it("does not read again when a decided last row leaves nothing waiting", async () => {
    const openPage = vi.fn().mockResolvedValue(pageOf([aProposal()]));
    renderWithStore(
      <>
        <OpenList name="a" />
        <Actions />
      </>,
      { api: fakeApi({ proposals: { openPage, reject: vi.fn().mockResolvedValue(aProposal({ state: "rejected" })) } }) },
    );
    await screen.findByText("a: p1=open of 1");
    await act(() => reject!.mutateAsync({ id: "p1" }));
    expect(await screen.findByText("a: none of 0")).toBeInTheDocument();
    expect(openPage).toHaveBeenCalledTimes(1);
  });

  it("refreshes the waiting count after each list read and after a decision", async () => {
    const count = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValue(1);
    const { client } = renderWithStore(
      <>
        <OpenList name="a" />
        <Count />
        <Actions />
      </>,
      { api: fakeApi({ proposals: { count, openPage: vi.fn().mockResolvedValue(pageOf([aProposal()])), approve: vi.fn().mockResolvedValue(aProposal({ state: "approved" })) } }) },
    );
    await screen.findByText("a: p1=open of 1");
    await screen.findByText("count: 2");
    const before = count.mock.calls.length;
    // A later read of the list, like the re-read while something waits for Shopify.
    await act(() => client.refetchQueries({ queryKey: proposalKeys.lists() }));
    await waitFor(() => expect(count).toHaveBeenCalledTimes(before + 1));
    await act(() => approve!.mutateAsync({ id: "p1" }));
    expect(await screen.findByText("count: 1")).toBeInTheDocument();
  });

  it("marks other cached pages out of date after a reject, so their totals and rows are read again", async () => {
    const { client } = renderWithStore(<Actions />, { api: fakeApi({ proposals: { reject: vi.fn().mockResolvedValue(aProposal({ state: "rejected" })) } }) });
    const page1 = proposalKeys.open({ page: 1, pageSize: 10 });
    const page2 = proposalKeys.open({ page: 2, pageSize: 10 });
    client.setQueryData(page1, pageOf([aProposal()], 11));
    client.setQueryData(page2, pageOf([aProposal({ id: "p11" })], 11));
    await act(() => reject!.mutateAsync({ id: "p1" }));
    expect(client.getQueryState(page2)?.isInvalidated).toBe(true);
  });

  it("keeps a decision when a read that started before it comes back afterwards", async () => {
    let answerLate: (v: unknown) => void = () => {};
    const openPage = vi
      .fn()
      .mockResolvedValueOnce(pageOf([aProposal()]))
      .mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)))
      .mockResolvedValue(pageOf([aProposal({ state: "approved" })]));
    const { client } = renderWithStore(
      <>
        <OpenList name="a" />
        <Actions />
      </>,
      { api: fakeApi({ proposals: { openPage, approve: vi.fn().mockResolvedValue(aProposal({ state: "approved" })) } }) },
    );
    await screen.findByText("a: p1=open of 1");
    void client.refetchQueries({ queryKey: proposalKeys.lists() }); // a re-read on its way
    await waitFor(() => expect(openPage).toHaveBeenCalledTimes(2));
    await act(() => approve!.mutateAsync({ id: "p1" }));
    await act(async () => answerLate(pageOf([aProposal()]))); // the old answer arrives late
    expect(await screen.findByText("a: p1=approved of 1")).toBeInTheDocument();
    expect(screen.queryByText("a: p1=open of 1")).toBeNull();
  });

  it("marks past suggestions out of date after a decision, so History reads them again", async () => {
    const { client } = renderWithStore(<Actions />, { api: fakeApi({ proposals: { approve: vi.fn().mockResolvedValue(aProposal({ state: "approved" })) } }) });
    const key = proposalKeys.history({ page: 1, pageSize: 10 });
    client.setQueryData(key, { proposals: [], hasMore: false, total: 0, page: 1, pageSize: 10 });
    await act(() => approve!.mutateAsync({ id: "p1" }));
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
