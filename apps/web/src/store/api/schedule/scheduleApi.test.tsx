// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createQueryClient } from "../api.js";
import { StoreProvider } from "../../StoreProvider.js";
import type { ScheduleRow } from "../../../api.js";
import { aRun, aSupplier, fakeApi } from "../../../test/fake-api.js";
import { renderWithStore } from "../../../test/renderWithStore.js";
import { supplierKeys } from "../suppliers/supplierApi.js";
import { scheduleKeys, useGetScheduleOverviewQuery, useGetScheduleRunsQuery, useSetScheduleMutation } from "./scheduleApi.js";

afterEach(cleanup);
const row = (supplierId: string) => ({ supplierId, status: { state: "idle" } }) as unknown as ScheduleRow;

function Overview({ name }: { name: string }) {
  const { data } = useGetScheduleOverviewQuery();
  return <p>{data ? `${name}: ${data.map((r) => r.supplierId).join(",")}` : `${name}: loading`}</p>;
}
function Runs() {
  const { data } = useGetScheduleRunsQuery("s1");
  return <p>{data ? `runs: ${data.length}` : "runs: loading"}</p>;
}
let save: ReturnType<typeof useSetScheduleMutation> | undefined;
function Actions() {
  save = useSetScheduleMutation();
  return null;
}

describe("the schedule in the cache", () => {
  it("asks the server once when the sidebar and a page both show the schedule", async () => {
    const overview = vi.fn().mockResolvedValue([row("s1")]);
    renderWithStore(
      <>
        <Overview name="a" />
        <Overview name="b" />
      </>,
      { api: fakeApi({ schedule: { overview } }) },
    );
    expect(await screen.findByText("a: s1")).toBeInTheDocument();
    expect(screen.getByText("b: s1")).toBeInTheDocument();
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it("after saving a supplier's schedule, shows the saved supplier and reads the schedule and its runs again", async () => {
    const saved = aSupplier({ id: "s1", scheduleIntervalMinutes: 60 });
    const overview = vi.fn().mockResolvedValue([row("s1")]);
    const runs = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([aRun()]);
    const { client } = renderWithStore(
      <>
        <Overview name="a" />
        <Runs />
        <Actions />
      </>,
      { api: fakeApi({ schedule: { overview, runs, set: vi.fn().mockResolvedValue(saved) } }) },
    );
    await screen.findByText("runs: 0");
    client.setQueryData(supplierKeys.detail("s1"), aSupplier({ id: "s1", scheduleIntervalMinutes: null }));
    await act(() => save!.mutateAsync({ supplierId: "s1", input: { intervalMinutes: 60, window: null, keepAliveMinutes: null } }));
    expect(client.getQueryData(supplierKeys.detail("s1"))).toEqual(saved);
    expect(await screen.findByText("runs: 1")).toBeInTheDocument();
    expect(overview).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(scheduleKeys.overview())?.status).toBe("success");
  });

  it("shows the cached schedule at once on a page opened again after 5 s, and reads it again because runs change by themselves", async () => {
    const overview = vi.fn().mockResolvedValueOnce([row("s1")]).mockResolvedValue([row("s1"), row("s2")]);
    const runs = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([aRun()]);
    const api = fakeApi({ schedule: { overview, runs } });
    // The app's own cache, so its 30-second freshness is in play.
    const client = createQueryClient();
    const page = () => (
      <StoreProvider api={api} client={client}>
        <Overview name="a" />
        <Runs />
      </StoreProvider>
    );
    const first = render(page());
    await screen.findByText("a: s1");
    await screen.findByText("runs: 0");
    first.unmount();
    // Opened again a little later: within 5 s the copy is used as it is, after that it is read again.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 6_000 });
    try {
      render(page());
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText("a: s1")).toBeInTheDocument(); // the cached copy, straight away
    expect(await screen.findByText("a: s1,s2")).toBeInTheDocument();
    expect(await screen.findByText("runs: 1")).toBeInTheDocument();
  });

  it("uses a read from the last 5 seconds as it is, so the sidebar and a page opening together ask once", async () => {
    const overview = vi.fn().mockResolvedValue([row("s1")]);
    const api = fakeApi({ schedule: { overview } });
    const client = createQueryClient();
    const view = (n: number) => (
      <StoreProvider api={api} client={client}>
        {Array.from({ length: n }, (_, i) => <Overview key={i} name={`a${i}`} />)}
      </StoreProvider>
    );
    const first = render(view(1));
    await screen.findByText("a0: s1");
    first.rerender(view(2)); // a page opens beside the sidebar
    await screen.findByText("a1: s1");
    expect(overview).toHaveBeenCalledTimes(1);
  });
});
