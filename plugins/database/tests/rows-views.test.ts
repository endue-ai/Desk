// The views that draw a whole result, on a read its cursor keeps (PG-22, ADR 0352): opening the Map
// (PG-46) or the Chart (PG-44) fetches every row first, as Fetch every row does, so they draw the
// whole result as before; past ALL_MAX they draw the rows held and say so. A whole result fetches
// nothing more.
import { describe, expect, it } from "vitest";
import type { ResultSet } from "../ui/engines/common.js";
import { ALL_MAX } from "../ui/rows/control.js";
import { whole } from "../ui/rows/window.js";
import { CAPTURED } from "./geo-corpus";
import type { Script } from "./harness";
import { rawRunsOf } from "./runs-of";
import { script as base, run, shop } from "./session-helpers";

const point = CAPTURED.find((c) => c.name === "point")?.hex ?? "";
const shapes = (count: number) => [
  ["id", "geom"],
  ...Array.from({ length: count }, (_, i) => [String(i + 1), point]),
];
const numbers = (count: number) => [
  ["n", "v"],
  ...Array.from({ length: count }, (_, i) => [String(i + 1), String((i % 7) + 1)]),
];
const script: Script = (sql, who) => {
  if (sql === "select id, geom from places") return { rows: shapes(1200) };
  if (sql === "select id, geom from everywhere") return { rows: shapes(ALL_MAX + 1) };
  if (sql === "select n, v from big") return { rows: numbers(1200) };
  return base(sql, who);
};
type Mounted = Awaited<ReturnType<typeof shop>>;
const tabs = (m: Mounted) => m.shown()?.shown?.tabs ?? [];
const rowsSet = (m: Mounted) => tabs(m).find((t) => t.kind === "rows")?.set as ResultSet;
const fetches = (m: Mounted) =>
  rawRunsOf(m.host.calls).filter((c) => /^FETCH/u.test(String((c.params as { sql?: string }).sql)))
    .length;

describe("a map or a chart of a read its cursor keeps", () => {
  it("the map fetches every row first and draws the whole result", async () => {
    const m = await shop({ script });
    await run(m, "select id, geom from places");
    expect(rowsSet(m).window).toMatchObject({ known: 500, done: false });
    await m.host.command("endue.database.show-map");
    await m.settle();
    const map = tabs(m).find((t) => t.kind === "map");
    expect(map?.geo?.set.rows).toHaveLength(1200);
    expect(map?.geo?.set.truncated).toBe(false);
    // The map and the grid show one result: the grid's is whole too.
    expect(map?.geo?.set).toBe(rowsSet(m));
    expect(whole(rowsSet(m))).toBe(true);
    // Whole now: picking the map again fetches nothing.
    const before = fetches(m);
    await m.host.command("endue.database.show-map");
    await m.settle();
    expect(fetches(m)).toBe(before);
  });

  it("the chart fetches every row first and draws from all of them", async () => {
    const m = await shop({ script });
    await run(m, "select n, v from big");
    await m.host.command("endue.database.chart", { type: "bar", x: "v", y: "n" });
    await m.settle();
    const chart = tabs(m).find((t) => t.kind === "chart");
    expect(chart?.chart?.set.rows).toHaveLength(1200);
    expect(chart?.chart?.set.truncated).toBe(false);
    expect(chart?.chart?.set).toBe(rowsSet(m));
    // Opening it again picks the same tab, not a second one.
    await m.host.command("endue.database.chart", {});
    expect(tabs(m).filter((t) => t.kind === "chart")).toHaveLength(1);
  });

  it("past every row Fetch every row holds, the map draws the rows held and says so", async () => {
    const m = await shop({ script });
    await run(m, "select id, geom from everywhere");
    await m.host.command("endue.database.show-map");
    await m.settle();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await m.settle();
    const map = tabs(m).find((t) => t.kind === "map");
    expect(map?.geo?.set.rows).toHaveLength(500);
    expect(map?.geo?.set.truncated).toBe(true);
    expect(m.view.said.join("\n")).toMatch(
      /Map: drawn from the 500 rows held\. More than 100,000 rows/u,
    );
  }, 30_000);
});
