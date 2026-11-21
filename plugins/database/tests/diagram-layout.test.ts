// The ER diagram's layout (PG-55, ui/features/diagram/{arrange,route,layout}.js): layers over the
// foreign keys without overlaps, a referenced table left of those that refer to it, cycles and self
// references laid out; the columns shown sizing the boxes; kept positions staying and new tables
// landing beside them; lines routed round a table in the way, ends on their boxes' sides with their
// cardinality marks; and 500 tables with 1,000 keys within budget, the worker answering as the frame.
import { describe, expect, it } from "vitest";
import { arrange, place } from "../ui/features/diagram/arrange.js";
import {
  layoutOf,
  moveBoxes,
  problemOf,
  rowsOf,
  sizeOf,
  solve,
} from "../ui/features/diagram/layout.js";
import { answer } from "../ui/features/diagram/layout-worker.js";
import { type Graph, idOf, type Table } from "../ui/features/diagram/model.js";
import { indexOf, routeOne, STUB } from "../ui/features/diagram/route.js";
import { endMark } from "../ui/features/diagram/svg.js";
import { bigTables } from "./diagram-fixture";

type Rect = { x: number; y: number; w: number; h: number };
const apart = (a: Rect, b: Rect) =>
  a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
const overlaps = (boxes: (Rect & { id?: string })[]) => {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (!apart(boxes[i] as Rect, boxes[j] as Rect)) out.push(`${boxes[i]?.id} ${boxes[j]?.id}`);
  return out;
};
const table = (name: string, columns = 3, schema = "public"): Table => ({
  id: idOf(schema, name),
  schema,
  name,
  comment: "",
  columns: Array.from({ length: columns }, (_, i) => ({
    name: i === 0 ? "id" : `c${i}`,
    type: "integer",
    nullable: i > 1,
    primary: i === 0,
    foreign: i === 1,
    comment: "",
  })),
});
const graphOf = (names: string[], links: [string, string][]): Graph => ({
  tables: names.map((n) => table(n)),
  links: links.map(([from, to], i) => ({
    name: `k${i}`,
    from: idOf("public", from),
    to: idOf("public", to),
    fromColumns: ["c1"],
    toColumns: ["id"],
    drawn: false,
    ends: { from: "many", to: "one" },
  })),
});
const laid = (g: Graph, kept = new Map<string, [number, number]>(), mode = "all" as const) => {
  const made = problemOf(g, mode, kept);
  return layoutOf(g, mode, made, solve(made.problem));
};
const at = (layout: ReturnType<typeof laid>, name: string) =>
  layout.boxes.find((b) => b.name === name) as ReturnType<typeof laid>["boxes"][number];

describe("the diagram's layout", () => {
  it("lays the graph out in layers", () => {
    const g = graphOf(
      ["customers", "orders", "lines", "products", "invoices", "lone", "a", "b", "selfish"],
      [
        ["orders", "customers"],
        ["lines", "orders"],
        ["lines", "products"],
        ["invoices", "orders"],
        ["a", "b"],
        ["b", "a"],
        ["selfish", "selfish"],
      ],
    );
    const layout = laid(g);
    expect(overlaps(layout.boxes)).toEqual([]);
    expect(at(layout, "customers").x).toBeLessThan(at(layout, "orders").x);
    expect(at(layout, "orders").x).toBeLessThan(at(layout, "lines").x);
    expect(at(layout, "products").x).toBeLessThan(at(layout, "lines").x);
    expect(layout.lines).toHaveLength(7);
    expect(layout.bounds.w).toBeGreaterThan(0);
    // Columns all, keys only and none size the boxes.
    const t = table("wide", 80);
    expect(rowsOf(t, "all")).toMatchObject({ more: 30 });
    expect(rowsOf(t, "all").rows).toHaveLength(50);
    expect(rowsOf(t, "keys").rows.map((c) => c.name)).toEqual(["id", "c1"]);
    expect(rowsOf(t, "none").rows).toEqual([]);
    const all = sizeOf("wide", rowsOf(t, "all").rows, 30).h;
    const keys = sizeOf("wide", rowsOf(t, "keys").rows).h;
    const none = sizeOf("wide", []).h;
    expect(all).toBeGreaterThan(keys);
    expect(keys).toBeGreaterThan(none);
    expect(laid(g, new Map(), "none" as never).boxes.every((b) => b.h === none)).toBe(true);
  });

  it("keeps what the person placed", () => {
    const g = graphOf(
      ["customers", "orders", "lines"],
      [
        ["orders", "customers"],
        ["lines", "orders"],
      ],
    );
    const kept = new Map<string, [number, number]>([
      [idOf("public", "customers"), [500, 40]],
      [idOf("public", "orders"), [40, 600]],
    ]);
    const layout = laid(g, kept);
    expect([at(layout, "customers").x, at(layout, "customers").y]).toEqual([500, 40]);
    expect([at(layout, "orders").x, at(layout, "orders").y]).toEqual([40, 600]);
    expect(overlaps(layout.boxes)).toEqual([]);
    const lines = at(layout, "lines");
    for (const name of ["customers", "orders"]) {
      const b = at(layout, name);
      expect(lines.x).toBeGreaterThanOrEqual(b.x + b.w);
    }
    // A dropped table leaves: only the shown tables have positions.
    const fewer = graphOf(["customers", "lines"], []);
    expect(laid(fewer, kept).boxes.map((b) => b.name)).toEqual(["customers", "lines"]);
    expect(place([{ id: "x", w: 10, h: 10 }], [], new Map([["x", [3, 4]]]))).toEqual(
      new Map([["x", [3, 4]]]),
    );
  });

  it("routes lines around tables", () => {
    const boxes = [
      { x: 0, y: 0, w: 140, h: 80 },
      { x: 600, y: 0, w: 140, h: 80 },
      { x: 300, y: -200, w: 140, h: 500 },
    ];
    const index = indexOf(boxes);
    const points = routeOne(index, { from: 0, to: 1, fromY: 40, toY: 40 });
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1] as [number, number];
      const [x2, y2] = points[i] as [number, number];
      expect(index.crossings(x1, y1, x2, y2, [0, 1]), `segment ${i}`).toBe(0);
    }
    // Every end lies on its box's side and leaves it straight for at least STUB.
    const [first, second] = points as [[number, number], [number, number]];
    const onSide = (p: [number, number], b: Rect) =>
      (p[0] === b.x || p[0] === b.x + b.w) && p[1] >= b.y && p[1] <= b.y + b.h;
    expect(onSide(first, boxes[0] as Rect)).toBe(true);
    expect(onSide(points.at(-1) as [number, number], boxes[1] as Rect)).toBe(true);
    expect(Math.abs(second[0] - first[0]) + Math.abs(second[1] - first[1])).toBeGreaterThanOrEqual(
      STUB,
    );
    // With room between them, the straight way between facing sides.
    const free = routeOne(indexOf(boxes.slice(0, 2)), { from: 0, to: 1, fromY: 40, toY: 40 });
    expect(free[0]).toEqual([140, 40]);
    expect(free.at(-1)).toEqual([600, 40]);
    // Each end carries its mark: two bars for one, a bar and a ring for zero or one, a foot for many.
    expect(endMark([0, 0], [10, 0], "one").lines.match(/M/gu)).toHaveLength(2);
    expect(endMark([0, 0], [10, 0], "zero-one").rings).not.toBe("");
    expect(endMark([0, 0], [10, 0], "many").lines).toContain("L 12 0");
    // A moved box takes its lines along.
    const g = graphOf(["a", "b"], [["a", "b"]]);
    const layout = laid(g);
    const before = JSON.stringify(layout.lines[0]?.points);
    moveBoxes(layout, new Map([[0, [layout.boxes[0]?.x ?? 0, (layout.boxes[0]?.y ?? 0) + 300]]]));
    expect(JSON.stringify(layout.lines[0]?.points)).not.toBe(before);
  });

  it("lays 500 tables and 1,000 foreign keys out within budget", () => {
    const tables = bigTables();
    const g: Graph = {
      tables: tables.map((t) => ({
        id: idOf("big", t.name),
        schema: "big",
        name: t.name,
        comment: "",
        columns: (t.columns ?? []).map(([name = "", type = "", flags = ""]) => ({
          name,
          type,
          nullable: !flags.includes("n"),
          primary: flags.includes("p"),
          foreign: name.endsWith("_id"),
          comment: "",
        })),
      })),
      links: tables.flatMap((t) =>
        (t.constraints ?? [])
          .filter((c) => c[0] === "f")
          .map((c) => ({
            name: c[1],
            from: idOf("big", t.name),
            to: idOf("big", c[5] ?? ""),
            fromColumns: c[3],
            toColumns: c[6] ?? [],
            drawn: false,
            ends: { from: "many" as const, to: "one" as const },
          })),
      ),
    };
    expect(g.links).toHaveLength(1000);
    const made = problemOf(g, "keys", new Map());
    const started = performance.now();
    const solution = solve(made.problem);
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(4000);
    const layout = layoutOf(g, "keys", made, solution);
    expect(overlaps(layout.boxes)).toEqual([]);
    expect(layout.lines.every((l) => l.points.length >= 4)).toBe(true);
    expect(answer({ id: 1, problem: structuredClone(made.problem) })).toEqual({ id: 1, solution });
    expect(arrange(made.problem.nodes, made.problem.edges).size).toBe(500);
  });
});
