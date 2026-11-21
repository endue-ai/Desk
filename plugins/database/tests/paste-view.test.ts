// @vitest-environment jsdom
// The grid takes a paste (PG-43, #470): the browser's paste event on the focused grid (Mod+V) hands
// its text on, none while a cell is edited or the grid is not focused; the keys of duplicate, fill
// down, NULL on a block and undo; where a paste lands; the cell's menu and the hint line.
import { beforeEach, describe, expect, it } from "vitest";
import { remember } from "../ui/clipboard.js";
import { emptyChanges } from "../ui/edit/pending.js";
import { hints } from "../ui/keys.js";
import { createGrid } from "../ui/view-grid.js";

type Act = [string, ...unknown[]];
const set = {
  columns: ["id", "name", "team"],
  rows: [
    ["3", "Cy", "b"],
    ["1", "Ada", "a"],
    ["2", "Bob", "b"],
  ] as (string | null)[][],
  truncated: false,
};
const tab = { label: "Result", kind: "rows" as const, statement: 0, set };
const known = (name: string, key = false) => ({ name, type: "text", key, known: true });
const edit = {
  key: "1:0",
  status: "ready" as const,
  reason: "",
  target: {
    dialect: "postgresql" as const,
    schema: "public",
    name: "t",
    columns: [known("id", true), known("name"), known("team")],
    key: [0],
  },
  changes: emptyChanges(),
  count: 0,
  message: "",
  history: [],
};
const context = { edit, server: false, key: "result:c-pg:1:0" };

let acts: Act[];
let grid: ReturnType<typeof createGrid>;
const host = () => document.getElementById("result") as HTMLElement;
const gridEl = () => host().querySelector("[role=grid]") as HTMLElement;
const press = (key: string, options: KeyboardEventInit = {}) =>
  gridEl().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
const paste = (text: string, target: EventTarget = gridEl()) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  target.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  document.body.innerHTML = `<div id="results"><div id="result"></div></div><textarea id="editor"></textarea>`;
  acts = [];
  grid = createGrid(document, host(), (action, ...args) => {
    acts.push([action, ...args]);
    return undefined;
  });
});

describe("the grid takes a paste", () => {
  it("hands the paste event's text on from the focused grid, and none from elsewhere", () => {
    grid.render(tab, true, context);
    gridEl().focus();
    const event = paste("a\tb\nc\td");
    expect(event.defaultPrevented).toBe(true);
    expect(acts.at(-1)).toEqual(["pasteText", "a\tb\nc\td"]);
    const editor = document.getElementById("editor") as HTMLTextAreaElement;
    editor.focus();
    acts = [];
    expect(paste("x", editor).defaultPrevented).toBe(false);
    expect(acts).toEqual([]);
  });

  it("leaves a paste to the cell's field while a cell is edited", () => {
    grid.render(tab, true, context);
    gridEl().focus();
    press("ArrowRight");
    press("Enter");
    const field = document.querySelector(".cell-input") as HTMLInputElement;
    expect(field).toBeTruthy();
    acts = [];
    expect(paste("typed", field).defaultPrevented).toBe(false);
    expect(acts).toEqual([]);
  });

  it("says where a paste lands: the block, the rows in screen order, the shown columns", () => {
    grid.render(tab, true, context);
    gridEl().focus();
    // id hidden, the rows sorted by name: Ada, Bob, Cy.
    press("h");
    press("s");
    press("Home");
    press("ArrowLeft");
    press("ArrowDown");
    press("ArrowRight", { shiftKey: true });
    expect(grid.command("cells")).toEqual({
      order: [1, 2, 0],
      columns: [1, 2],
      top: 1,
      bottom: 1,
      left: 0,
      right: 1,
    });
    grid.toggleRecord();
    expect(grid.command("cells")).toBe(
      "Leave the record view (t) first: a paste, a fill or a clear works on the grid's rows.",
    );
  });

  it("reads the text the grid copied with its escapes, any other as a spreadsheet's", () => {
    grid.render(tab, true, context);
    remember("a\\tb");
    expect(grid.command("readPaste", { text: "a\\tb" })).toEqual({
      rows: [["a\tb"]],
      format: "value",
    });
    expect(grid.command("readPaste", { text: "c\\td" })).toEqual({
      rows: [["c\\td"]],
      format: "value",
    });
  });

  it("runs duplicate, fill down, NULL on a block and undo by key", () => {
    grid.render(tab, true, context);
    gridEl().focus();
    press("D", { shiftKey: true });
    press('"', { shiftKey: true });
    press("z", { metaKey: true });
    press("ArrowDown", { shiftKey: true });
    press("n");
    expect(acts.map(([action]) => action)).toEqual([
      "duplicateRows",
      "fillDown",
      "undoChange",
      "clearCells",
    ]);
    // On one cell, n sets that cell to NULL as before.
    acts = [];
    press("ArrowRight");
    press("n");
    expect(acts).toEqual([["editCell", 1, 1, null]]);
  });

  it("offers Duplicate and Fill down in the cell's menu of a result that can change", () => {
    grid.render(tab, true, context);
    gridEl().focus();
    press("f");
    const menu = document.querySelector(".grid-menu") as HTMLElement;
    const rows = [...menu.querySelectorAll("[data-row]")].map((i) => i.textContent);
    expect(rows).toEqual(["Duplicate the selected rows (D)", 'Fill down (")']);
    const item = menu.querySelector('[data-row="duplicateRows"]') as HTMLElement;
    menu.dispatchEvent(new CustomEvent("desk-select", { detail: { item }, bubbles: true }));
    expect(acts.at(-1)).toEqual(["duplicateRows"]);
    grid.render(tab, true, { edit: null, server: false, key: "result:c-pg:1:0" });
    press("f");
    expect(menu.querySelectorAll("[data-row]")).toHaveLength(0);
  });

  it("names Mod+V, duplicate, fill down and undo on the hint line", () => {
    const line = hints("grid");
    for (const part of ["Mod+V paste", "Mod+Z undo", "D duplicate", '" fill down'])
      expect(line).toContain(part);
  });
});
