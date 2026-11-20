// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
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
});
