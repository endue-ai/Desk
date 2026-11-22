// A chart's data from a result (PG-44, ui/chart/aggregate.js, engine.js, client.js): rows grouped
// by the X column and split by a series column, aggregated exactly (sum, average, count, minimum,
// maximum), a scatter's points, what is left out past the limits; the same answer from the worker
// for a large result, whose columns are sent to it once.
import { describe, expect, it } from "vitest";
import { groupChart } from "../ui/chart/aggregate.js";
import { createChartClient } from "../ui/chart/client.js";
import { createChartEngine } from "../ui/chart/engine.js";

const set = (columns: string[], rows: (string | null)[][], truncated = false) => ({
  columns,
  rows,
  truncated,
});
const sales = set(
  ["month", "region", "amount"],
  [
    ["2026-01", "north", "1.10"],
    ["2026-01", "south", "2"],
    ["2026-02", "north", "0.20"],
    ["2026-01", "north", "9007199254740993"],
    ["2026-02", "south", null],
  ],
);
const reader = (s: typeof sales) => (row: number, col: number) => s.rows[row]?.[col] ?? null;

const grouped = (settings: Record<string, string>, s = sales) =>
  groupChart({
    count: s.rows.length,
    value: reader(s),
    columns: s.columns,
    settings: { type: "bar", x: "month", y: "amount", series: "", aggregate: "sum", ...settings },
  });

describe("a chart's data", () => {
  it("groups by X in the order the rows come, and sums exactly", () => {
    const data = grouped({});
    expect(data.categories).toEqual(["2026-01", "2026-02"]);
    expect(data.series).toEqual([{ name: "amount", values: ["9007199254740996.10", "0.20"] }]);
  });

  it("splits by a series column, and averages, counts, takes minimum and maximum", () => {
    expect(grouped({ series: "region" }).series).toEqual([
      { name: "north", values: ["9007199254740994.10", "0.20"] },
      { name: "south", values: ["2", null] },
    ]);
    expect(grouped({ aggregate: "avg" }).series[0]?.values).toEqual([
      "3002399751580332.03333333",
      "0.2",
    ]);
    expect(grouped({ aggregate: "count" }).series[0]?.values).toEqual(["3", "1"]);
    expect(grouped({ aggregate: "count", y: "" }).series[0]).toEqual({
      name: "rows",
      values: ["3", "2"],
    });
    expect(grouped({ aggregate: "min" }).series[0]?.values).toEqual(["1.10", "0.20"]);
    expect(grouped({ aggregate: "max" }).series[0]?.values).toEqual(["9007199254740993", "0.20"]);
  });

  it("orders numeric X by value for a line, and leaves out values that are not numbers", () => {
    const s = set(
      ["x", "y"],
      [
        ["10", "1"],
        ["2", "abc"],
        ["2", "3"],
        [null, "4"],
      ],
    );
    const data = groupChart({
      count: 4,
      value: reader(s),
      columns: s.columns,
      settings: { type: "line", x: "x", y: "y", series: "", aggregate: "sum" },
    });
    expect(data.categories).toEqual(["2", "10", "NULL"]);
    expect(data.series[0]?.values).toEqual(["3", "1", "4"]);
    expect(data.skipped).toBe(1);
  });

  it("pairs a scatter's points by series, numbers only", () => {
    const data = grouped({ type: "scatter", x: "amount", y: "amount", series: "region" });
    expect(data.points).toEqual([
      { x: "1.10", y: "1.10", series: 0 },
      { x: "2", y: "2", series: 1 },
      { x: "0.20", y: "0.20", series: 0 },
      { x: "9007199254740993", y: "9007199254740993", series: 0 },
    ]);
    expect(data.series.map((s) => s.name)).toEqual(["north", "south"]);
  });

  it("says what it leaves out past its limits: categories, series and slices", () => {
    const many = set(
      ["k", "s", "v"],
      Array.from({ length: 80 }, (_, i) => [`k${i}`, `s${i % 9}`, "1"]),
    );
    const bars = groupChart({
      count: 80,
      value: reader(many),
      columns: many.columns,
      settings: { type: "bar", x: "k", y: "v", series: "s", aggregate: "sum" },
    });
    expect(bars.categories).toHaveLength(50);
    expect(bars.series).toHaveLength(6);
    expect(bars.dropped).toEqual({ categories: 30, series: 3, points: 0 });
    const pie = groupChart({
      count: 80,
      value: reader(many),
      columns: many.columns,
      settings: { type: "pie", x: "k", y: "v", series: "s", aggregate: "sum" },
    });
    expect(pie.categories).toHaveLength(6);
    expect(pie.series).toHaveLength(1);
    expect(pie.dropped.categories).toBe(74);
  });
});

/** A worker on the same engine, answering a turn later as a real one does. */
function fakeWorkers() {
  const posted: Array<Record<string, unknown>> = [];
  const start = () => {
    const engine = createChartEngine();
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null,
      postMessage(message: Record<string, unknown>) {
        posted.push(message);
        setTimeout(() => worker.onmessage?.({ data: engine.answer(message as never) }), 0);
      },
      terminate() {},
    };
    return worker as unknown as Worker;
  };
  return { posted, start };
}

describe("the chart's worker", () => {
  const big = set(
    ["n", "team"],
    Array.from({ length: 30_000 }, (_, i) => [`${i % 7}.5`, i % 2 ? "odd" : "even"]),
  );

  it("answers a large selection's totals as the frame does, each column sent once", async () => {
    const { posted, start } = fakeWorkers();
    const client = createChartClient(start, 20_000);
    const rows = Array.from({ length: 30_000 }, (_, i) => i);
    const asked = client.totals(big, null, rows, [0]);
    expect(asked).toBeInstanceOf(Promise);
    const inFrame = createChartClient(undefined).totals(big, null, rows, [0]);
    expect(await asked).toEqual(inFrame);
    expect(inFrame).toMatchObject({ count: 30_000, distinct: 7, min: "0.5", max: "6.5" });
    await client.totals(big, null, rows.slice(0, 25_000), [0]);
    const sent = posted.map((p) => Object.keys((p.data as object) ?? {}));
    expect(sent).toEqual([["0"], []]);
  });

  it("groups a large result's chart off the frame, the same as in it", async () => {
    const { start } = fakeWorkers();
    const settings = { type: "bar", x: "team", y: "n", series: "", aggregate: "sum" } as const;
    const asked = createChartClient(start, 20_000).chart(big, settings);
    expect(asked).toBeInstanceOf(Promise);
    const inFrame = createChartClient(undefined).chart(big, settings);
    expect(await asked).toEqual(inFrame);
    expect(inFrame).toMatchObject({ categories: ["even", "odd"] });
  });

  it("counts a selection's pending changes with it", () => {
    const changes = {
      updates: new Map([[0, new Map([[0, "100"]])]]),
      inserts: [],
      deletes: new Set<number>(),
    };
    const totals = createChartClient(undefined).totals(big, changes, [0, 1], [0]);
    expect(totals).toMatchObject({ sum: "101.5", max: "100" });
  });
});
