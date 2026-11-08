import type { UniversalData } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { chartOf, detailOf, rowsOf, statOf, type UniversalEnv } from "./index";

// Chart, stat and detail (ADR 0103): what item views drew as components, over universal rows.
const env: UniversalEnv = {
  zone: "Asia/Seoul",
  locale: "en-US",
  now: Date.parse("2026-11-04T10:00:00+09:00"),
};
const builds: UniversalData = {
  map: { start: "at", value: "seconds" },
  entries: [
    { id: "b3", title: "Third", at: "2026-11-03T09:00:00+09:00", seconds: 300 },
    { id: "b1", title: "First", at: "2026-11-01T09:00:00+09:00", seconds: "240" },
    { id: "b2", title: "Second", at: "2026-11-02T09:00:00+09:00", seconds: 180 },
  ],
};
const tasks: UniversalData = {
  map: { group: "status" },
  entries: [
    { id: "t1", title: "Spec", status: "done", owner: "Mina", due: "2026-11-05" },
    { id: "t2", title: "Build", status: "open" },
    { id: "t3", title: "Ship", status: "open", raw: { deep: true } },
  ],
};

describe("universal figures", () => {
  it("reads the value role as a number, numeric strings included", () => {
    expect(rowsOf(builds).map((row) => row.value)).toEqual([300, 240, 180]);
    expect(rowsOf(tasks)[0]).not.toHaveProperty("value");
  });

  it("charts the value role over time in order, and counts per group without one", () => {
    const line = chartOf(rowsOf(builds, { map: builds.map, zone: env.zone }), env, "line");
    expect(line.kind).toBe("line");
    expect(line.points.map((p) => [p.key, p.value])).toEqual([
      ["b1", 240],
      ["b2", 180],
      ["b3", 300],
    ]);
    expect(line.points[0]?.label).toContain("Nov 1");
    expect([line.min, line.max]).toEqual([0, 300]);
    const counts = chartOf(rowsOf(tasks), env);
    expect(counts.kind).toBe("bar");
    expect(counts.points).toEqual([
      { key: "done", label: "done", value: 1 },
      { key: "open", label: "open", value: 2 },
    ]);
    expect(chartOf([], env).points).toEqual([]);
  });

  it("counts, sums or takes the latest value by start", () => {
    const rows = rowsOf(builds, { zone: env.zone });
    expect(statOf(rows)).toEqual({ value: 3, aggregate: "count" });
    expect(statOf(rows, "sum")).toEqual({ value: 720, aggregate: "sum" });
    expect(statOf(rows, "latest")).toEqual({ value: 300, aggregate: "latest" });
    expect(statOf(rowsOf(tasks), "sum")).toEqual({ value: null, aggregate: "sum" });
    expect(statOf([], "count")).toEqual({ value: 0, aggregate: "count" });
  });

  it("details the selected row, else the first: its roles, then its other plain fields", () => {
    const rows = rowsOf(tasks);
    const first = detailOf(rows, env);
    expect(first.row?.id).toBe("t1");
    // Roles by name, a group that only repeats the status left out, other fields spelled out.
    expect(first.fields).toEqual([
      { label: "Status", value: "done" },
      { label: "Owner", value: "Mina" },
      { label: "Due", value: "2026-11-05" },
    ]);
    // An item's entry: its connector as From, an instant as a day and time.
    const item = rowsOf({
      entries: [
        {
          id: "i1",
          title: "Buy groceries",
          group: "home",
          status: "open",
          source: { connector: "desk.fixtures", instance: "default" },
          updatedAt: "2026-11-03T21:00:00+09:00",
        },
      ],
    });
    expect(detailOf(item, env).fields).toEqual([
      { label: "Group", value: "home" },
      { label: "Status", value: "open" },
      { label: "From", value: "desk.fixtures" },
      { label: "Updated at", value: "Tue, Nov 3 21:00" },
    ]);
    expect(detailOf(rows, env, "t3").row?.title).toBe("Ship");
    expect(detailOf(rows, env, "t3").fields.map((f) => f.label)).not.toContain("raw");
    expect(detailOf([], env)).toEqual({ row: null, fields: [] });
  });
});
