// @vitest-environment jsdom
// What the page draws (PG-44): the footer's totals of the grid's selection (ui/chart/totals.js, by
// way of grid/screen.js), and the Chart tab (ui/chart/view.js): bars, lines, areas, a scatter and a
// pie in the theme's chart tokens that reach 3:1 in both schemes, a table for screen readers with
// the exact values, the settings that draw it again, and the note that not every row was fetched.
import { beforeEach, describe, expect, it } from "vitest";
import { contrast, over } from "../../../packages/ui/src/theme/index";
import { SERIES } from "../ui/chart/draw.js";
import { createCharts } from "../ui/chart/view.js";
import { createGrid } from "../ui/view-grid.js";
import { Palette, scheme } from "./contrast-css";

type Act = [string, ...unknown[]];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const rowsTab = (truncated = false) => ({
  label: "Result",
  kind: "rows" as const,
  statement: 0,
  set: {
    columns: ["id", "name", "amount"],
    rows: [
      ["3", "Cy", "0.1"],
      ["1", "Ada", "0.2"],
      ["10", "Bob", null],
      ["2", "Dee", "9007199254740993"],
    ],
    truncated,
  },
});
const context = { edit: null, server: false, key: "result:c:1:0" };

let acts: Act[];
beforeEach(() => {
  document.body.innerHTML = `<div id="results"><div id="result"></div></div><footer><p id="totals"></p></footer>`;
  acts = [];
});
const host = () => document.getElementById("result") as HTMLElement;
const totals = () => document.getElementById("totals")?.textContent ?? "";
const press = (key: string, options: KeyboardEventInit = {}) =>
  host()
    .querySelector("[role=grid]")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));

describe("the selection's totals in the footer", () => {
  const grid = () =>
    createGrid(document, host(), (action, ...args) => {
      acts.push([action, ...args]);
      return undefined;
    });

  it("show count, distinct, sum, average, minimum and maximum of a block, exactly", async () => {
    const g = grid();
    g.render(rowsTab(), true, context);
    expect(totals()).toBe("");
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    await flush();
    expect(totals()).toBe(
      "Count 3 · Distinct 3 · Sum 9007199254740993.3 · Average 3002399751580331.1 · Min 0.1 · Max 9007199254740993 · 1 NULL",
    );
  });

  it("count text without a sum, and say when not every row is fetched", async () => {
    const g = grid();
    g.render(rowsTab(true), true, context);
    press("ArrowRight");
    press("ArrowDown", { shiftKey: true });
    await flush();
    expect(totals()).toBe(
      "Count 2 · Distinct 2 · Min Ada · Max Cy · of the 4 rows fetched (more not loaded)",
    );
  });

  it("go when the tab on screen holds no rows", async () => {
    const g = grid();
    g.render(rowsTab(), true, context);
    press("ArrowDown", { shiftKey: true });
    await flush();
    expect(totals()).toMatch(/^Count 2/u);
    g.render({ label: "Messages", kind: "messages", statement: -1, lines: [] } as never, true, context);
    await flush();
    expect(totals()).toBe("");
  });
});

const sales = (truncated = false) => ({
  label: "Chart",
  kind: "chart" as const,
  statement: 0,
  chart: {
    set: {
      columns: ["team", "amount", "region"],
      rows: [
        ["red", "1.10", "north"],
        ["blue", "2", "south"],
        ["red", "0.20", "south"],
        ["<b>green</b>", "4", "north"],
      ],
      truncated,
    },
  },
});

describe("the Chart tab", () => {
  const charts = () =>
    createCharts(document, (action, ...args) => {
      acts.push([action, ...args]);
      return undefined;
    });
  const svg = () => host().querySelector("svg[role=img]") as SVGElement;
  const choose = (name: string, value: string) => {
    const select = host().querySelector(`select[name="${name}"]`) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const table = () =>
    [...host().querySelectorAll("table.sr-only tr")].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    );

  it("draws the result's bars by its first text and first number column, summed", async () => {
    charts().show(host(), sales());
    await flush();
    expect(svg().getAttribute("aria-label")).toBe("Bar chart of the sum of amount by team");
    expect(host().querySelectorAll("rect.chart-bar")).toHaveLength(3);
    expect(table()).toEqual([
      ["team", "amount"],
      ["red", "1.30"],
      ["blue", "2"],
      ["<b>green</b>", "4"],
    ]);
    // A label is text, never markup.
    expect(host().querySelector("svg b")).toBeNull();
    expect(svg().textContent).toContain("<b>green</b>");
  });

  it("draws again with a series, as lines, areas, a scatter and a pie", async () => {
    const tab = sales();
    charts().show(host(), tab);
    await flush();
    choose("series", "region");
    await flush();
    expect(host().querySelectorAll("rect.chart-bar")).toHaveLength(4);
    expect(table()[0]).toEqual(["team", "north", "south"]);
    expect(acts.at(-1)).toEqual([
      "chartChanged",
      { type: "bar", x: "team", y: "amount", series: "region", aggregate: "sum" },
    ]);
    expect(tab.chart).toMatchObject({ settings: { series: "region" } });
    choose("type", "line");
    await flush();
    expect(host().querySelectorAll("path.chart-line")).toHaveLength(2);
    choose("type", "area");
    await flush();
    expect(host().querySelectorAll("path.chart-area")).toHaveLength(2);
    choose("type", "scatter");
    choose("x", "amount");
    await flush();
    expect(host().querySelectorAll("circle.chart-dot")).toHaveLength(4);
    choose("type", "pie");
    choose("x", "team");
    await flush();
    expect(host().querySelectorAll("path.chart-slice")).toHaveLength(3);
  });

  it("paints series in chart tokens that reach 3:1 on every surface in both schemes", async () => {
    charts().show(host(), sales());
    await flush();
    choose("series", "region");
    await flush();
    const fills = [...host().querySelectorAll("rect.chart-bar")].map((r) =>
      r.getAttribute("fill"),
    );
    expect(new Set(fills)).toEqual(new Set(SERIES.slice(0, 2).map((t) => `var(${t})`)));
    for (const name of ["light", "dark"] as const) {
      const palette = new Palette(scheme(name), []);
      const rgba = (token: string) => palette.paints(`var(${token})`)?.[0]?.rgba ?? [0, 0, 0, 0];
      const card = rgba("--desk-card");
      for (const token of SERIES)
        for (const ground of ["background", "card", "muted", "popover", "hover"])
          expect([name, token, ground, contrast(rgba(token), over(rgba(`--desk-${ground}`), card)) >= 3]).toEqual([name, token, ground, true]);
    }
  });

  it("says a chart of a result not fully fetched is drawn from the rows that were", async () => {
    charts().show(host(), sales(true));
    await flush();
    expect(host().querySelector(".chart-note")?.textContent).toBe(
      "Drawn from the 4 rows fetched: the result has more that were not loaded.",
    );
    charts().show(host(), sales(false));
    await flush();
    expect(host().querySelector(".chart-note")?.textContent ?? "").toBe("");
  });

  it("exports from its button", async () => {
    charts().show(host(), sales());
    await flush();
    (host().querySelector("button[data-chart=export]") as HTMLButtonElement).click();
    expect(acts.at(-1)).toEqual(["chartExport"]);
  });
});
