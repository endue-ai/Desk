// What the map's worker does with a column of shapes (PG-46, ui/geo/): simplify each to its zoom
// level, leave out what is out of view, draw a shape under a pixel as a dot, a colour per row in a
// few batched paths with the picked row last, only the selected rows when asked; pick the shape
// under a point; and the plane's units, graticule step, scale bar and zoom. On a context that
// records what it was asked to draw.
import { describe, expect, it } from "vitest";
import type { Context, Style } from "../ui/geo/draw.js";
import { drawLayer } from "../ui/geo/draw.js";
import { createEngine } from "../ui/geo/engine.js";
import { buildLayer, pickAt } from "../ui/geo/layer.js";
import { fitView, gridStep, scaleBar, toData, unitsOf, zoomAt } from "../ui/geo/plane.js";
import { simplify } from "../ui/geo/simplify.js";
import { CAPTURED } from "./geo-corpus";

type Call = [string, ...unknown[]];
const COLORS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];

/** A 2D context that records its calls; fill and stroke say their colour, alpha and width. */
function recorder() {
  const calls: Call[] = [];
  const ctx = {
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    lineJoin: "",
    beginPath: () => calls.push(["beginPath"]),
    moveTo: (x: number, y: number) => calls.push(["moveTo", x, y]),
    lineTo: (x: number, y: number) => calls.push(["lineTo", x, y]),
    closePath: () => calls.push(["closePath"]),
    rect: (x: number, y: number, w: number, h: number) => calls.push(["rect", x, y, w, h]),
    fill: () => calls.push(["fill", ctx.fillStyle, ctx.globalAlpha]),
    stroke: () => calls.push(["stroke", ctx.strokeStyle, ctx.lineWidth]),
    fillText: (text: string) => calls.push(["fillText", text]),
    clearRect: () => calls.push(["clearRect"]),
    save: () => {},
    restore: () => {},
  };
  return { ctx: ctx as unknown as Context, calls };
}

const style = (over: Partial<Style> = {}): Style => ({
  width: 800,
  height: 500,
  colors: COLORS,
  accent: "accent",
  grid: "grid",
  label: "label",
  font: "11px mono",
  picked: -1,
  subset: null,
  units: "units",
  ...over,
});
const square = (x: number, y: number, size = 1) =>
  `POLYGON((${x} ${y}, ${x + size} ${y}, ${x + size} ${y + size}, ${x} ${y + size}, ${x} ${y}))`;
const grid = (columns: number, rows: number) =>
  Array.from({ length: columns * rows }, (_, i) =>
    square((i % columns) * 2, Math.floor(i / columns) * 2),
  );

describe("drawing a column of shapes", () => {
  it("simplifies to the pixel off the frame and draws a colour per row", () => {
    // A straight line of 1,000 positions with noise under the tolerance is its two ends.
    const line = Float64Array.from({ length: 2000 }, (_, i) =>
      i % 2 ? (i % 4 === 1 ? 0.01 : -0.01) : i / 2,
    );
    const kept = simplify(line, 0.5);
    expect([...kept]).toEqual([0, 0.01, 999, -0.01]);
    // A zigzag over the tolerance stays; a ring keeps its first and last positions.
    const zig = Float64Array.from([0, 0, 1, 5, 2, 0, 3, 5, 4, 0]);
    expect(simplify(zig, 0.5).length).toBe(10);
    const ring = Float64Array.from({ length: 2002 }, (_, i) => {
      const a = (Math.floor(i / 2) / 1000) * Math.PI * 2;
      return i % 2 ? Math.sin(a) * 100 : Math.cos(a) * 100;
    });
    // Exactly closed, as a ring is.
    ring[2000] = ring[0] ?? 0;
    ring[2001] = ring[1] ?? 0;
    const round = simplify(ring, 1);
    expect(round.length).toBeLessThan(200);
    expect([round[0], round[1]]).toEqual([round.at(-2), round.at(-1)]);

    // Twenty thousand squares at fit: each drawn, a few batched paths in all.
    const layer = buildLayer(grid(200, 100), "wkt");
    expect(layer.shapes).toHaveLength(20_000);
    const view = fitView(layer.bounds, 800, 500, "units");
    const { ctx, calls } = recorder();
    const drawn = drawLayer(ctx, layer, view, style());
    expect(drawn.shapes).toBe(20_000);
    const fills = calls.filter((c) => c[0] === "fill");
    expect(fills.length).toBeLessThanOrEqual(COLORS.length);
    expect(new Set(fills.map((c) => c[1]))).toEqual(new Set(COLORS));
    // Zoomed far out each is a dot; zoomed into a corner most are out of view.
    const far = drawLayer(recorder().ctx, layer, { ...view, scale: view.scale / 50 }, style());
    expect([far.shapes, far.dots]).toEqual([20_000, 20_000]);
    const near = drawLayer(recorder().ctx, layer, zoomAt(view, 40, 30, 30, 800, 500), style());
    expect(near.shapes).toBeLessThan(200);
    // A circle of 10,000 positions 40 pixels across is drawn with far fewer.
    const circle = buildLayer(["<(0,0),20>"], "circle");
    const dense = buildLayer(
      [
        `POLYGON((${[...Array(10_001).keys()].map((i) => `${Math.cos(i / 1591.5) * 20} ${Math.sin(i / 1591.5) * 20}`).join(", ")}))`,
      ],
      "wkt",
    );
    expect(circle.shapes).toHaveLength(1);
    const few = drawLayer(
      recorder().ctx,
      dense,
      fitView(dense.bounds, 40, 40, "units", 0),
      style({ width: 40, height: 40 }),
    );
    expect(few.vertices).toBeLessThan(400);

    // Row colours by row number; the picked row last in the accent; only the selected rows.
    const three = buildLayer([square(0, 0), square(2, 0), square(4, 0)], "wkt");
    const at = fitView(three.bounds, 800, 500, "units");
    const picked = recorder();
    drawLayer(picked.ctx, three, at, style({ picked: 1 }));
    const painted = picked.calls.filter((c) => c[0] === "fill" || c[0] === "stroke");
    expect(painted.map((c) => c[1])).toEqual(["grid", "c1", "c1", "c3", "c3", "accent", "accent"]);
    expect(painted.at(-1)).toEqual(["stroke", "accent", 2.5]);
    expect(drawLayer(recorder().ctx, three, at, style({ subset: [2] })).shapes).toBe(1);
  });

  it("picks the shape under a point, and gives the graticule and the scale round steps in the SRID's units", () => {
    const hole = CAPTURED.find((c) => c.name === "polygon with a hole")?.hex ?? "";
    const layer = buildLayer(
      [hole, "LINESTRING(20 0, 30 0)", square(5, 5, 10), "POINT(40 40)"],
      "wkt",
    );
    expect(layer.failed.map((f) => f.row)).toEqual([0]);
    const mixed = buildLayer(
      [square(0, 0, 10), square(5, 5, 10), "POINT(40 40)", "LINESTRING(20 0, 30 0)"],
      "wkt",
    );
    expect(pickAt(mixed, 1, 1, 0.1)).toBe(0);
    expect(pickAt(mixed, 7, 7, 0.1)).toBe(1); // drawn last of the two that hold it
    expect(pickAt(mixed, 25, 0.3, 0.5)).toBe(3);
    expect(pickAt(mixed, 25, 2, 0.5)).toBe(-1);
    expect(pickAt(mixed, 40.2, 40.1, 0.5)).toBe(2);
    expect(pickAt(mixed, 7, 7, 0.1, 1, new Set([0]))).toBe(0);
    const holed = buildLayer([hole], "wkb");
    expect([pickAt(holed, 1, 1, 0.01), pickAt(holed, 3, 3, 0.01)]).toEqual([0, -1]);

    expect([unitsOf(4326), unitsOf(3857), unitsOf(32652), unitsOf(2154), unitsOf(0)]).toEqual([
      "degrees",
      "mercator",
      "metres",
      "units",
      "units",
    ]);
    const seoul = fitView([126.9, 37.5, 127.1, 37.6], 800, 500, "degrees");
    expect(seoul.kx).toBeCloseTo(Math.cos((37.55 * Math.PI) / 180), 5);
    expect(gridStep(seoul)).toBe(0.02);
    const bar = scaleBar(seoul, "degrees");
    expect(bar.label).toBe("2 km");
    expect(bar.px).toBeGreaterThan(40);
    expect(bar.px).toBeLessThanOrEqual(120);
    expect(scaleBar({ cx: 0, cy: 0, scale: 3, kx: 1 }, "units").label).toBe("20 units");
    expect(scaleBar({ cx: 0, cy: 0, scale: 0.2, kx: 1 }, "metres").label).toBe("500 m");
    const one = fitView([3, 4, 3, 4], 800, 500, "units");
    expect(Number.isFinite(one.scale) && one.scale > 0).toBe(true);
    const before = toData(seoul, 100, 80, 800, 500);
    const after = toData(zoomAt(seoul, 3, 100, 80, 800, 500), 100, 80, 800, 500);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    const labels = recorder();
    drawLayer(labels.ctx, buildLayer([], "wkb"), seoul, style({ units: "degrees" }));
    expect(labels.calls.filter((c) => c[0] === "fillText").map((c) => c[1])).toContain("127.00°");
  });

  it("answers the worker's requests: read, draw to a bitmap, pick, read curves back, let go", () => {
    const made: Array<{ width: number; height: number }> = [];
    const engine = createEngine((width, height) => {
      made.push({ width, height });
      const { ctx } = recorder();
      return {
        getContext: () => Object.assign(ctx, { scale: () => {} }),
        transferToImageBitmap: () => ({ width, height }) as unknown as ImageBitmap,
      };
    });
    const arc = CAPTURED.find((c) => c.name === "circular string")?.hex ?? "";
    const values = [CAPTURED[0]?.hex ?? "", null, arc, "zz"];
    const loaded = engine.answer({ id: 1, op: "load", key: "k", kind: "wkb", values }).reply;
    expect(loaded.summary).toMatchObject({
      rows: 4,
      shapes: 1,
      srid: 4326,
      types: { Point: 1 },
      unread: [{ row: 2, type: "CircularString" }],
      failed: 1,
    });
    const view = fitView([126, 37, 128, 38], 400, 300, "degrees");
    const { reply, transfer } = engine.answer({
      id: 2,
      op: "draw",
      key: "k",
      view,
      style: style({ width: 400, height: 300 }),
      ratio: 2,
    });
    expect(made).toEqual([{ width: 800, height: 600 }]);
    expect(reply.drawn).toMatchObject({ shapes: 1 });
    expect(transfer).toEqual([reply.bitmap]);
    const back = engine.answer({
      id: 3,
      op: "read",
      key: "k",
      rows: [2],
      texts: ['{"type":"LineString","coordinates":[[0,0],[1,1],[2,0]]}'],
    }).reply;
    expect(back.summary).toMatchObject({
      shapes: 2,
      unread: [],
      types: { Point: 1, LineString: 1 },
    });
    const picked = engine.answer({
      id: 4,
      op: "pick",
      key: "k",
      x: 126.978,
      y: 37.5665,
      tolerance: 0.01,
      kx: 1,
      subset: null,
    }).reply;
    expect(picked).toMatchObject({ row: 0, facts: { type: "Point", srid: 4326, vertices: 1 } });
    expect(
      engine.answer({ id: 5, op: "step", key: "k", from: 0, delta: 1, subset: null }).reply.row,
    ).toBe(2);
    engine.answer({ id: 6, op: "drop", key: "k" });
    expect(engine.answer({ id: 7, op: "facts", key: "k", row: 0 }).reply.error).toMatch(/gone/u);
  });
});
