// Several rows selected at once (#313): a click selects one, Shift-click and Shift+arrows extend a
// range from the anchor, Mod-click toggles one, Mod+A selects every row on screen, and the count is
// said on the status line, which is a live region, so a screen reader hears it.
import { describe, expect, it } from "vitest";
import { all, range, spoken, toggle } from "../ui/selection.js";
import type { Row } from "../ui/tree.js";
import { DOCS, disk, mount, sample } from "./harness";

const WORK = `${DOCS}/Work`;
const row = (name: string, kind: Row["kind"] = "file"): Row => ({
  id: kind === "more" ? `more:${DOCS}` : `${DOCS}/${name}`,
  path: kind === "more" ? DOCS : `${DOCS}/${name}`,
  name,
  kind,
  depth: 1,
  root: DOCS,
  hidden: false,
});
const list = [row("a"), row("b"), row("c"), row("d"), row("2 more", "more")];
const ids = (names: string[]) => names.map((name) => `${DOCS}/${name}`);

describe("the selection model", () => {
  it("a range runs from the anchor to the row, either way, and never takes a 'more' row", () => {
    expect(range(list, `${DOCS}/b`, `${DOCS}/d`)).toEqual(ids(["b", "c", "d"]));
    expect(range(list, `${DOCS}/d`, `${DOCS}/b`)).toEqual(ids(["b", "c", "d"]));
    expect(range(list, `${DOCS}/c`, `more:${DOCS}`)).toEqual(ids(["c", "d"]));
    // Without an anchor on screen, the range is the row alone.
    expect(range(list, null, `${DOCS}/c`)).toEqual(ids(["c"]));
  });

  it("toggling adds or removes one row; all takes every row but 'more'", () => {
    expect([...toggle(new Set(ids(["a"])), `${DOCS}/c`)]).toEqual(ids(["a", "c"]));
    expect([...toggle(new Set(ids(["a", "c"])), `${DOCS}/a`)]).toEqual(ids(["c"]));
    expect([...all(list)]).toEqual(ids(["a", "b", "c", "d"]));
  });

  it("says how many are selected, and nothing for one", () => {
    expect(spoken(0)).toBe("");
    expect(spoken(1)).toBe("");
    expect(spoken(3)).toBe("3 selected");
  });
});

describe("selecting several rows in the explorer", () => {
  it("a click selects one; Shift-click extends from it; Mod-click toggles one", async () => {
    const { app, view } = await mount({ handlers: disk(sample()) });
    app.pick(`${DOCS}/a2.md`, {});
    expect(view.marked()).toEqual([`${DOCS}/a2.md`]);
    app.pick(`${DOCS}/b.txt`, { shift: true });
    expect(view.marked()).toEqual(ids(["a2.md", "a10.md", "b.txt"]));
    expect(view.selected()).toBe(`${DOCS}/b.txt`);
    expect(view.statuses.at(-1)).toBe("3 selected");
    app.pick(`${DOCS}/a10.md`, { mod: true });
    expect(view.marked()).toEqual(ids(["a2.md", "b.txt"]));
    expect(view.statuses.at(-1)).toBe("2 selected");
    app.pick(WORK, { mod: true });
    expect(view.marked()).toEqual([WORK, ...ids(["a2.md", "b.txt"])]);
    // A plain click starts again from one row.
    app.pick(`${DOCS}/zed`, {});
    expect(view.marked()).toEqual([`${DOCS}/zed`]);
    expect(view.statuses.at(-1)).toBe("");
  });

  it("Shift+arrows extend the range from the anchor and shrink it back", async () => {
    const { app, view } = await mount({ handlers: disk(sample()) });
    app.select(`${DOCS}/a2.md`);
    await app.key("ArrowDown", { shift: true });
    await app.key("ArrowDown", { shift: true });
    expect(view.marked()).toEqual(ids(["a2.md", "a10.md", "b.txt"]));
    expect(view.selected()).toBe(`${DOCS}/b.txt`);
    await app.key("ArrowUp", { shift: true });
    expect(view.marked()).toEqual(ids(["a2.md", "a10.md"]));
    await app.key("End", { shift: true });
    expect(view.marked()).toEqual(ids(["a2.md", "a10.md", "b.txt", "zed"]));
    // An arrow without Shift moves one row and selects it alone.
    await app.key("ArrowUp");
    expect(view.marked()).toEqual([`${DOCS}/b.txt`]);
  });

  it("Mod+A (select-all) selects every row on screen and says so", async () => {
    const { host, view } = await mount({ handlers: disk(sample()) });
    await expect(host.command("endue.explorer.select-all")).resolves.toBe(6);
    expect(view.marked()).toHaveLength(6);
    expect(view.statuses.at(-1)).toBe("6 selected");
  });

  it("rows that leave the screen leave the selection", async () => {
    const { app, view } = await mount({ handlers: disk(sample()) });
    await app.activate(WORK);
    app.pick(`${WORK}/c.md`, {});
    app.pick(`${DOCS}/a2.md`, { mod: true });
    expect(view.marked()).toEqual([`${WORK}/c.md`, `${DOCS}/a2.md`]);
    await app.activate(WORK);
    expect(view.marked()).toEqual([`${DOCS}/a2.md`]);
  });
});
