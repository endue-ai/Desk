// The grid's columns without the DOM (ui/grid/columns.js): which columns show and where, by name,
// what each operation does to the state a table view keeps, and which columns of a wide result are
// drawn for a scroll position.
import { describe, expect, it } from "vitest";
import {
  columnKeys,
  emptyColumns,
  fitWidth,
  hide,
  inView,
  keepColumns,
  layoutOf,
  MAX_WIDTH,
  MIN_WIDTH,
  move,
  moveTo,
  pin,
  readColumns,
  resize,
  show,
} from "../ui/grid/columns.js";

const names = ["id", "name", "note", "id"];
const keys = columnKeys(names);
const defaults = [50, 80, 100, 60];

describe("the grid's column layout", () => {
  it("lays the columns out: hidden ones out, pinned ones first, the widths set, their offsets", () => {
    expect(keys).toEqual(["id", "name", "note", "id#2"]);
    const plain = layoutOf(names, emptyColumns(), defaults);
    expect(plain).toMatchObject({
      keys,
      visible: [0, 1, 2, 3],
      pinned: 0,
      widths: [50, 80, 100, 60],
      offsets: [0, 50, 130, 230],
      total: 290,
      pinnedWidth: 0,
    });
    let state = hide(emptyColumns(), "note");
    state = pin(state, keys, "id#2");
    state = resize(state, "name", 120);
    const shaped = layoutOf(names, state, defaults);
    expect(shaped.visible).toEqual([3, 0, 1]);
    expect(shaped.pinned).toBe(1);
    expect(shaped.widths).toEqual([60, 50, 120]);
    expect(shaped.offsets).toEqual([0, 60, 110]);
    expect(shaped.pinnedWidth).toBe(60);
    expect(shaped.total).toBe(230);
  });

  it("hides, shows, moves, pins and resizes by name, and keeps the state when the columns come back in another order", () => {
    let state = emptyColumns();
    state = move(state, keys, "note", -1);
    expect(layoutOf(names, state, defaults).visible).toEqual([0, 2, 1, 3]);
    // A move past the end of the block changes nothing; moveTo clamps into the block.
    expect(move(state, keys, "id", -1)).toEqual(state);
    state = moveTo(state, keys, "id", 99);
    expect(layoutOf(names, state, defaults).visible).toEqual([2, 1, 3, 0]);
    // Pinning puts the column at the end of the pinned block; a move stays inside its block.
    state = pin(state, keys, "id");
    state = pin(state, keys, "name");
    expect(layoutOf(names, state, defaults)).toMatchObject({ visible: [0, 1, 2, 3], pinned: 2 });
    expect(move(state, keys, "name", 1)).toEqual(state);
    state = move(state, keys, "name", -1);
    expect(layoutOf(names, state, defaults).visible).toEqual([1, 0, 2, 3]);
    // Unpinning puts it first after the pinned block.
    state = pin(state, keys, "name");
    expect(layoutOf(names, state, defaults)).toMatchObject({ visible: [0, 1, 2, 3], pinned: 1 });
    state = hide(state, "note");
    expect(layoutOf(names, state, defaults).visible).toEqual([0, 1, 3]);
    state = show(state, "note");
    expect(layoutOf(names, state, defaults).visible).toEqual([0, 1, 2, 3]);
    expect(resize(state, "note", 2).widths.note).toBe(MIN_WIDTH);
    expect(resize(state, "note", 99_999).widths.note).toBe(MAX_WIDTH);
    // The same state over the columns in another order, one gone and one new.
    state = resize(hide(state, "id#2"), "note", 200);
    const again = layoutOf(["extra", "note", "name", "id"], state, [70, 10, 20, 30]);
    expect(again.keys).toEqual(["extra", "note", "name", "id"]);
    expect(again.visible).toEqual([3, 2, 1, 0]);
    expect(again.pinned).toBe(1);
    expect(again.widths).toEqual([30, 20, 200, 70]);
  });

  it("draws only the columns in view of a 300-column result", () => {
    const wide = Array.from({ length: 300 }, (_, i) => `c${i}`);
    const state = pin(pin(emptyColumns(), columnKeys(wide), "c0"), columnKeys(wide), "c1");
    const layout = layoutOf(wide, state, new Array(300).fill(100));
    expect(layout.pinnedWidth).toBe(200);
    // The content from scrollLeft + the pinned block to scrollLeft + the width.
    expect(inView(layout, 1000, 500, 0)).toEqual({ from: 12, to: 15 });
    expect(inView(layout, 1000, 500, 2)).toEqual({ from: 10, to: 17 });
    expect(inView(layout, 0, 500)).toEqual({ from: 2, to: 7 });
    expect(inView(layout, 29_500, 500, 2)).toEqual({ from: 295, to: 300 });
    const narrow = layoutOf(["a", "b"], emptyColumns(), [50, 50]);
    expect(inView(narrow, 0, 900)).toEqual({ from: 0, to: 2 });
  });

  it("reads back only a state it understands", () => {
    const state = resize(pin(hide(emptyColumns(), "note"), keys, "name"), "id", 90);
    const kept = keepColumns(state);
    expect(kept).toEqual({ v: 1, ...state });
    expect(readColumns(structuredClone(kept))).toEqual(state);
    for (const bad of [
      undefined,
      null,
      "columns",
      { ...kept, v: 2 },
      { ...kept, order: "id" },
      { ...kept, hidden: [1] },
      { ...kept, widths: [] },
    ])
      expect(readColumns(bad)).toEqual(emptyColumns());
    expect(readColumns({ ...kept, widths: { id: 5, name: "x" } }).widths).toEqual({
      id: MIN_WIDTH,
    });
  });

  it("fits a column to its longest text and its name", () => {
    const set = {
      columns: ["a", "title"],
      rows: [
        ["xxxx", "t"],
        [null, "t"],
      ],
      truncated: false,
    };
    // Chars as the default widths count them (name + 3, room for a sort key's arrow and number; a
    // value + 1), 17 px of padding and border.
    expect(fitWidth(set, 0, 10)).toBe(67);
    expect(fitWidth(set, 1, 10)).toBe(97);
    const long = { columns: ["a"], rows: [["y".repeat(5000)]], truncated: false };
    expect(fitWidth(long, 0, 10)).toBe(1017);
  });
});
