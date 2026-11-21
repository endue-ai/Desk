// @vitest-environment jsdom
// The result grid's DOM (ui/view-grid.js, ui/grid/): its columns hidden, moved, pinned and resized
// by key, a sort by more than one column, quick filters with the chip that says where they run,
// find with Mod+F, and a wide result drawn a few columns at a time.
import { beforeEach, describe, expect, it } from "vitest";
import { createGrid } from "../ui/view-grid.js";

type Act = [string, ...unknown[]];
const rows: (string | null)[][] = [
  ["3", "Cy", "b"],
  ["1", "Ada", "a"],
  ["10", "Bob", "b"],
  ["2", "Dee", "a"],
];
const tab = (columns = ["id", "name", "team"], data = rows) => ({
  label: "Result",
  kind: "rows" as const,
  statement: 0,
  set: { columns, rows: data, truncated: false },
});
const console1 = { edit: null, server: false, key: "result:c-lite:1:0" };

let acts: Act[];
let grid: ReturnType<typeof createGrid>;
const host = () => document.getElementById("result") as HTMLElement;
const gridEl = () => host().querySelector("[role=grid]") as HTMLElement;
const headers = () =>
  [...host().querySelectorAll<HTMLElement>("[role=columnheader]")].map((h) => h.dataset.key);
const header = (key: string) =>
  host().querySelector<HTMLElement>(`[role=columnheader][data-key="${key}"]`) as HTMLElement;
const column = (c: number) =>
  [...host().querySelectorAll(".body [role=row]")].map(
    (row) => row.querySelector(`[aria-colindex="${c + 1}"]`)?.textContent,
  );
const press = (key: string, options: KeyboardEventInit = {}, target: Element = gridEl()) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
const click = (el: Element, options: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, ...options }));
const strip = () => document.querySelector(".grid-strip") as HTMLElement;
const findBar = () => document.querySelector(".grid-find") as HTMLElement;
const findInput = () => findBar().querySelector("input") as HTMLInputElement;

beforeEach(() => {
  document.body.innerHTML = `<div id="results"><div id="result"></div></div><textarea id="editor"></textarea>`;
  acts = [];
  grid = createGrid(document, host(), (action, ...args) => {
    acts.push([action, ...args]);
    return undefined;
  });
});

describe("the grid's columns", () => {
  it("hides, moves, pins and resizes the cursor's column by key; aria-colcount and aria-colindex follow", () => {
    grid.render(tab(), true, console1);
    expect(headers()).toEqual(["id", "name", "team"]);
    expect(gridEl().getAttribute("aria-colcount")).toBe("3");
    gridEl().focus();
    press("h");
    expect(headers()).toEqual(["name", "team"]);
    // The grid is drawn again in place: it keeps the focus.
    expect(document.activeElement).toBe(gridEl());
    expect(gridEl().getAttribute("aria-colcount")).toBe("2");
    expect(
      [...host().querySelectorAll("[role=columnheader]")].map((h) =>
        h.getAttribute("aria-colindex"),
      ),
    ).toEqual(["1", "2"]);
    expect(column(0)).toEqual(["Cy", "Ada", "Bob", "Dee"]);
    press(">", { shiftKey: true });
    expect(headers()).toEqual(["team", "name"]);
    expect(grid.cursorCell()?.name).toBe("name");
    press("P", { shiftKey: true });
    expect(headers()).toEqual(["name", "team"]);
    expect(header("name").classList.contains("pinned")).toBe(true);
    const width = () => grid.columns().widths[0] ?? 0;
    press("w");
    const fitted = width();
    press(")", { shiftKey: true });
    expect(width()).toBeGreaterThan(fitted);
    press("(", { shiftKey: true });
    press("(", { shiftKey: true });
    expect(width()).toBeLessThan(fitted);
    press("w");
    expect(width()).toBe(fitted);
    press("H", { shiftKey: true });
    expect(acts).toContainEqual(["showColumns"]);
    expect(grid.columns().hidden).toEqual(["id"]);
    grid.command("show", { column: "id" });
    expect(headers()).toEqual(["name", "id", "team"]);
    grid.command("reset");
    expect(headers()).toEqual(["id", "name", "team"]);
    expect(header("name").classList.contains("pinned")).toBe(false);
  });

  it("keeps a table view's columns through its key, and reads them back", async () => {
    let kept: unknown;
    const saved = { order: [], hidden: ["team"], pinned: [], widths: {} };
    grid = createGrid(document, host(), (action, ...args) => {
      acts.push([action, ...args]);
      if (action === "columnsLoad") return Promise.resolve(saved);
      if (action === "columnsKeep") kept = args[1];
      return undefined;
    });
    const table = {
      edit: null,
      server: true,
      key: "table:c-lite:main.people",
      sort: [],
      filters: [],
    };
    grid.render(tab(), true, table);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acts).toContainEqual(["columnsLoad", "table:c-lite:main.people"]);
    expect(headers()).toEqual(["id", "name"]);
    press("h");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(kept).toMatchObject({ hidden: ["team", "id"] });
  });
});

describe("the grid's sort", () => {
  it("sorts by a second column with Shift+click and S, numbered in the header, aria-sort on the first key only", () => {
    grid.render(tab(), true, console1);
    click(header("team"));
    expect(header("team").getAttribute("aria-sort")).toBe("ascending");
    expect(column(0)).toEqual(["1", "2", "3", "10"]);
    click(header("id"), { shiftKey: true });
    click(header("id"), { shiftKey: true });
    expect(column(0)).toEqual(["2", "1", "10", "3"]);
    expect(header("team").getAttribute("aria-sort")).toBe("ascending");
    expect(header("id").getAttribute("aria-sort")).toBe("none");
    expect(header("id").querySelector(".sort")?.textContent).toBe("▼2");
    expect(header("id").textContent).toContain("sorted second, descending");
    expect(header("team").querySelector(".sort")?.textContent).toBe("▲1");
    // S on the cursor's column (id) drops it; on name adds it.
    press("S", { shiftKey: true });
    expect(header("id").querySelector(".sort")).toBeNull();
    press("ArrowRight");
    press("S", { shiftKey: true });
    expect(column(0)).toEqual(["1", "2", "10", "3"]);
    // A plain click sorts by that column alone.
    click(header("name"));
    expect(column(0)).toEqual(["1", "10", "3", "2"]);
    expect(header("team").getAttribute("aria-sort")).toBe("none");
    expect(gridEl().getAttribute("aria-colcount")).toBe("3");
  });

  it("asks the server for a table view's sort keys", () => {
    const table = {
      edit: null,
      server: true,
      key: "table:c-lite:main.people",
      sort: [],
      filters: [],
    };
    grid.render(tab(), true, table);
    click(header("team"));
    click(header("id"), { shiftKey: true });
    expect(acts.filter(([a]) => a === "sort").at(-1)).toEqual([
      "sort",
      [
        { key: "team", name: "team", direction: "asc" },
        { key: "id", name: "id", direction: "asc" },
      ],
    ]);
    // The rows stay as the server sent them.
    expect(column(0)).toEqual(["3", "1", "10", "2"]);
  });
});

describe("quick filters", () => {
  it("a quick filter from the cell keeps the rows that match, and its chip says where it runs", () => {
    grid.render(tab(), true, console1);
    press("ArrowRight");
    press("=");
    expect(column(1)).toEqual(["Cy"]);
    expect(strip().hidden).toBe(false);
    expect(strip().textContent).toContain("On these rows");
    expect(strip().textContent).toContain("name = 'Cy'");
    click(strip().querySelector("[data-remove]") as Element);
    expect(column(1)).toEqual(["Cy", "Ada", "Bob", "Dee"]);
    expect(strip().hidden).toBe(true);
    // The cell's menu offers each filter for its value.
    press("ArrowDown");
    press("f");
    const menu = document.querySelector(".grid-menu") as HTMLElement;
    const labels = [...menu.querySelectorAll("[data-filter]")].map((i) => i.textContent);
    expect(labels).toEqual([
      "= 'Ada'",
      "≠ 'Ada'",
      "> 'Ada'",
      "< 'Ada'",
      "Contains…",
      "Is empty",
      "Is NULL",
      "Is not NULL",
    ]);
    const item = menu.querySelector('[data-filter="gt"]') as HTMLElement;
    menu.dispatchEvent(new CustomEvent("desk-select", { detail: { item }, bubbles: true }));
    expect(column(1)).toEqual(["Cy", "Bob", "Dee"]);
    press("F", { shiftKey: true });
    expect(column(1)).toHaveLength(4);
    // In a table view the filter goes to the server, and the chip says so.
    const table = {
      edit: null,
      server: true,
      key: "table:c-lite:main.people",
      sort: [],
      filters: [],
    };
    grid.render(tab(), true, table);
    press("ArrowRight");
    press("=");
    const asked = { key: "name", name: "name", op: "eq" as const, value: "Cy", numeric: false };
    expect(acts).toContainEqual(["filters", [asked]]);
    expect(column(1)).toHaveLength(4);
    grid.render(tab(), false, { ...table, filters: [asked] });
    expect(strip().textContent).toContain("On the server");
    expect(strip().textContent).toContain("name = 'Cy'");
  });
});

describe("find in the grid", () => {
  it("Mod+F finds in the grid, Enter and Shift+Enter move to the next and previous match with its count, Escape gives the grid back; the editor's Mod+F is left alone", () => {
    grid.render(tab(), true, console1);
    press("f", { metaKey: true });
    expect(findBar().hidden).toBe(false);
    expect(document.activeElement).toBe(findInput());
    findInput().value = "b";
    findInput().dispatchEvent(new Event("input", { bubbles: true }));
    const count = () => findBar().querySelector("[role=status]")?.textContent;
    const at = () => grid.cursorCell();
    expect(count()).toBe("1 of 3");
    expect(at()).toMatchObject({ row: 0, col: 2 });
    press("Enter", {}, findInput());
    expect(at()).toMatchObject({ row: 2, col: 1 });
    press("Enter", {}, findInput());
    press("Enter", {}, findInput());
    expect(count()).toBe("1 of 3");
    press("Enter", { shiftKey: true }, findInput());
    expect(count()).toBe("3 of 3");
    expect(at()).toMatchObject({ row: 2, col: 2 });
    // Whole cell leaves "Bob" out; match case keeps both "b" cells.
    click(findBar().querySelector('[data-find="whole"]') as Element);
    expect(count()).toBe("2 of 2");
    expect(host().querySelectorAll(".cell.found").length).toBe(2);
    click(findBar().querySelector('[data-find="case"]') as Element);
    expect(count()).toBe("2 of 2");
    press("Escape", {}, findInput());
    expect(findBar().hidden).toBe(true);
    expect(document.activeElement).toBe(gridEl());
    const editor = document.getElementById("editor") as HTMLElement;
    editor.focus();
    press("f", { metaKey: true }, editor);
    expect(findBar().hidden).toBe(true);
  });
});

describe("a wide result", () => {
  it("a wide result draws only the columns in view, and the cursor's column scrolls into view", () => {
    const columns = Array.from({ length: 300 }, (_, i) => `c${i}`);
    const wide = [columns.map((c) => `${c}v`), columns.map(() => null)];
    grid.render(tab(columns, wide), true, console1);
    expect(gridEl().getAttribute("aria-colcount")).toBe("300");
    const drawn = () => host().querySelectorAll("[role=columnheader]").length;
    expect(drawn()).toBeLessThan(40);
    expect(host().querySelectorAll(".body [role=row]:first-child [role=gridcell]").length).toBe(
      drawn(),
    );
    for (let i = 0; i < 299; i++) press("ArrowRight");
    expect(drawn()).toBeLessThan(40);
    expect(host().querySelector('[role=columnheader][aria-colindex="300"]')).not.toBeNull();
    expect(host().querySelector('.body [aria-colindex="300"].cursor')?.textContent).toBe("c299v");
    expect((host().querySelector(".scroller") as HTMLElement).scrollLeft).toBeGreaterThan(0);
  });
});
