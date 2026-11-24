// @vitest-environment jsdom
// The one panel box (ui/view-panel.js): the ER diagram draws there as it did in its own box, and a
// feature's panel module is drawn, updated in place and destroyed when another panel shows or its
// buffer closes.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Console } from "../ui/consoles.js";
import { graphFromRows } from "../ui/features/diagram/model.js";
import { stateOf } from "../ui/features/diagram/read.js";
import * as builtins from "../ui/features/index.js";
import { diagramOf } from "../ui/schema/diagram.js";
import { createView } from "../ui/view.js";
import { fakeFeature } from "./fake-feature";
import { SAVED } from "./harness";

const html = readFileSync("plugins/database/ui/index.html", "utf8");
const conn = SAVED[0] ?? null;
const byId = (id: string) => document.getElementById(id) as HTMLElement;

const columns = [
  ["orders", "id", "integer", "YES"],
  ["orders", "customer_id", "integer", "NO"],
  ["customers", "id", "integer", "YES"],
  ["notes", "body", "text", "NO"],
];
const keys = [["orders", "orders_customer_fk", "customer_id", "customers", "id"]];
/** A diagram's state over the rows, as the feature draws it. */
const diagramState = (rows = keys) =>
  stateOf(
    { id: "c-lite", name: "Notes" } as never,
    "main",
    graphFromRows("main", diagramOf(columns, rows)),
    { choice: { schemas: ["main"] }, mode: "all", at: [], added: [], removed: [], drawn: [] },
    { schemas: ["main"] },
  );

/** A buffer as consoles.js keeps it: a panel's state sits under its type. */
function buffer(id: string, kind: string, name: string, state: unknown): Console {
  return {
    id,
    kind,
    connection: "c-lite",
    name,
    text: "",
    table: null,
    execution: null,
    shown: null,
    running: false,
    tab: 0,
    maxRows: 500,
    edit: null,
    page: null,
    [kind]: state,
  } as Console;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});

afterEach(() => {
  expect(document.querySelector("#editor-box .cm-editor")).toBeNull();
});

describe("the panel box", () => {
  it("draws the ER diagram into the one panel box as before", async () => {
    const act = vi.fn();
    const view = createView(document, act);
    const state = await diagramState();
    const placed = state.layout;
    const diagram = buffer("b-1", "diagram", "er: Notes · main", state);
    view.console(diagram, conn);
    const box = byId("panel-box");
    expect(box.hidden).toBe(false);
    expect(box.getAttribute("aria-label")).toBe("ER diagram");
    for (const id of ["editor-box", "table-bar", "results", "empty"])
      expect(byId(id).hidden).toBe(true);
    expect(document.getElementById("diagram-box")).toBeNull();
    expect(byId("title").textContent).toBe("Notes · main");
    const svg = box.querySelector(".diagram svg.er");
    expect(svg?.getAttribute("aria-label")).toBe("3 tables, 1 relations");
    expect(box.querySelectorAll("g.er-table")).toHaveLength(3);
    expect(box.querySelectorAll("g.er-link polyline")).toHaveLength(1);
    expect(
      document.querySelector('link[rel="stylesheet"][href$="features/diagram/diagram.css"]'),
    ).not.toBeNull();

    const first = box.querySelector("g.er-table") as SVGGElement;
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(act).toHaveBeenCalledWith("openTable", "c-lite", "main", placed.boxes[0]?.name);

    // The same diagram is not drawn again, nor after a console showed in between.
    view.console(diagram, conn);
    view.console(buffer("b-2", "console", "db: Notes", null), conn);
    expect(box.hidden).toBe(true);
    view.console(diagram, conn);
    expect(box.querySelector("svg.er")).toBe(svg);
    view.console({ ...diagram, id: "b-3", diagram: await diagramState([]) }, conn);
    expect(box.querySelector("svg.er")).not.toBe(svg);
    expect(box.querySelectorAll("g.er-link polyline")).toHaveLength(0);
  });

  it("draws a feature's panel module, updates it in place, and destroys it when another panel shows or its buffer closes", () => {
    const log: string[] = [];
    const act = vi.fn();
    const view = createView(document, act, [...Object.values(builtins), fakeFeature(log)]);
    const box = byId("panel-box");
    view.console(buffer("b-1", "fake", "count: Notes", { n: 1 }), conn);
    expect(box.getAttribute("aria-label")).toBe("Counter");
    expect(byId("title").textContent).toBe("Notes");
    const button = box.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("1");
    view.console(buffer("b-1", "fake", "count: Notes", { n: 2 }), conn);
    expect(box.querySelector("button")).toBe(button);
    expect(button.textContent).toBe("2");
    button.click();
    expect(act).toHaveBeenCalledWith("fakeBump", 1);
    view.console(buffer("b-2", "fake", "count: Shop", { n: 9 }), conn);
    expect(box.querySelector("button")?.textContent).toBe("9");
    view.closed?.("b-2");
    expect(box.childElementCount).toBe(0);
    expect(log).toEqual([
      "render b-1 1",
      "update b-1 2",
      "destroy b-1",
      "render b-2 9",
      "destroy b-2",
    ]);
  });
});
