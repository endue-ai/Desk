// @vitest-environment jsdom
// The grid's side of following foreign keys (PG-41, #468): a key's cells are drawn as links with
// their title once the controller answers which columns link (a NULL cell links nowhere), `g` and
// Mod+click follow, `r` lists the referencing rows, `b` goes back, Enter on an editable key cell
// opens the search instead of the field, and the cell's menu offers both ways.
import { beforeEach, describe, expect, it } from "vitest";
import { emptyChanges } from "../ui/edit/pending.js";
import { createGrid } from "../ui/view-grid.js";

type Act = [string, ...unknown[]];
const set = {
  columns: ["id", "person", "total"],
  rows: [
    ["1", "1", "12.00"],
    ["2", null, "30.00"],
  ] as (string | null)[][],
  truncated: false,
};
const tab = { label: "Result", kind: "rows" as const, statement: 0, set };
const known = (name: string, key = false) => ({ name, type: "integer", key, known: true });
const edit = {
  key: "1:0",
  status: "ready" as const,
  reason: "",
  target: {
    dialect: "postgresql" as const,
    schema: "public",
    name: "orders",
    columns: [known("id", true), known("person"), known("total")],
    key: [0],
  },
  changes: emptyChanges(),
  count: 0,
  message: "",
  history: [],
};
const TITLE = "Points at public.people (id): g or Mod+click opens that row";
const context = { edit, server: true, key: "table:c-pg:public.orders" };

let acts: Act[];
let grid: ReturnType<typeof createGrid>;
const host = () => document.getElementById("result") as HTMLElement;
const gridEl = () => host().querySelector("[role=grid]") as HTMLElement;
const cell = (row: number, col: number) =>
  host().querySelector(`[aria-rowindex="${row + 2}"] [aria-colindex="${col + 1}"]`) as HTMLElement;
const press = (key: string, options: KeyboardEventInit = {}) =>
  gridEl().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const named = (list: Act[], name: string) => list.filter(([action]) => action === name);

beforeEach(() => {
  document.body.innerHTML = `<div id="results"><div id="result"></div></div><textarea id="editor"></textarea>`;
  acts = [];
  grid = createGrid(document, host(), (action, ...args) => {
    acts.push([action, ...args]);
    if (action === "linksLoad")
      return Promise.resolve({ columns: [{ col: 1, title: TITLE }], referenced: true });
    return undefined;
  });
});

describe("the grid links a foreign key's cells", () => {
  it("draws a key's cells as links with their title, a NULL one plain, asked once per result", async () => {
    grid.render(tab, true, context);
    expect(named(acts, "linksLoad")).toHaveLength(1);
    expect(cell(0, 1).classList.contains("link")).toBe(false);
    await tick();
    expect(cell(0, 1).classList.contains("link")).toBe(true);
    expect(cell(0, 1).title).toBe(TITLE);
    expect(cell(1, 1).classList.contains("link")).toBe(false);
    expect(cell(0, 2).classList.contains("link")).toBe(false);
    // The same result drawn again asks nothing; another result asks again.
    grid.render(tab, false, context);
    expect(named(acts, "linksLoad")).toHaveLength(1);
    grid.render(tab, true, { ...context, key: "result:c-pg:2:0" });
    expect(named(acts, "linksLoad")).toHaveLength(2);
  });

  it("follows on g and on Mod+click of a link cell, and a plain click only moves", async () => {
    grid.render(tab, true, context);
    await tick();
    cell(0, 1).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(named(acts, "followKey")).toHaveLength(0);
    cell(0, 1).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, metaKey: true }));
    expect(named(acts, "followKey")).toHaveLength(1);
    expect(grid.cursorCell()).toMatchObject({ row: 0, col: 1 });
    cell(0, 2).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, ctrlKey: true }));
    expect(named(acts, "followKey")).toHaveLength(1);
    press("g");
    expect(named(acts, "followKey")).toHaveLength(2);
    press("r");
    expect(named(acts, "referencingRows")).toHaveLength(1);
    press("b");
    expect(named(acts, "goBack")).toHaveLength(1);
  });

  it("opens the search on Enter in an editable key cell, and the field elsewhere", async () => {
    grid.render(tab, true, context);
    await tick();
    gridEl().focus();
    press("ArrowRight");
    press("Enter");
    expect(named(acts, "pickKey")).toHaveLength(1);
    expect(host().querySelector(".cell-input")).toBeNull();
    press("ArrowRight");
    press("Enter");
    expect(named(acts, "pickKey")).toHaveLength(1);
    expect(host().querySelector(".cell-input")).not.toBeNull();
  });

  it("offers both ways in the cell's menu", async () => {
    grid.render(tab, true, context);
    await tick();
    const menu = document.querySelector(".grid-menu") as HTMLElement;
    const links = () => [...menu.querySelectorAll("[data-link]")].map((item) => item.textContent);
    press("ArrowRight");
    press("f");
    expect(links()).toEqual(["Go to the row it points at (g)", "Rows that point at this row (r)"]);
    const item = menu.querySelector('[data-link="followKey"]') as HTMLElement;
    menu.dispatchEvent(new CustomEvent("desk-select", { detail: { item }, bubbles: true }));
    expect(acts.at(-1)).toEqual(["followKey"]);
    press("ArrowRight");
    press("f");
    expect(links()).toEqual(["Rows that point at this row (r)"]);
  });
});
