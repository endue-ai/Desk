// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSheet } from "../ui/model.js";
import { createView } from "../ui/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const ROWS = 100_000;
const COLS = 50;

/** 100 000 rows by 50 columns, made on demand: the row number in A, "needle" twice. */
const big = () =>
  createSheet({
    name: "Big",
    rows: ROWS,
    cols: COLS,
    cellAt: (r, c) => {
      if ((r === 4 && c === 2) || (r === 70_000 && c === 10))
        return { t: "s", v: "needle", w: "needle" };
      if (c === 0) return { t: "n", v: r + 1, w: String(r + 1) };
      return c === 1 ? { t: "s", v: `row ${r + 1}`, w: `row ${r + 1}` } : undefined;
    },
  });

/** A1:A3 hold 1, 2 and 3; A4 sums them. */
const small = () =>
  createSheet({
    name: "Small",
    rows: 4,
    cols: 1,
    cellAt: (r, c) => {
      if (c !== 0) return undefined;
      if (r < 3) return { t: "n", v: r + 1, w: String(r + 1) };
      return r === 3 ? { t: "n", v: 6, w: "6", f: "SUM(A1:A3)" } : undefined;
    },
  });

/** The plugin's page in jsdom, with a 800 by 600 grid (jsdom has no layout). */
function page() {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const script of parsed.querySelectorAll("script")) script.remove();
  document.body.replaceWith(document.importNode(parsed.body, true));
  const scroller = document.getElementById("grid-scroll") as HTMLElement;
  Object.defineProperty(scroller, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
  const view = createView(document);
  view.show({
    buffer: "file:~/big.xlsx",
    path: "~/big.xlsx",
    name: "big.xlsx",
    size: 1,
    book: { kind: "sheets", format: "Excel workbook", detail: "", sheets: [big(), small()] },
  });
  const grid = document.querySelector('[role="grid"]') as HTMLElement;
  const text = (id: string) => document.getElementById(id)?.textContent ?? "";
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  const press = (key: string, mods: KeyboardEventInit = {}, target: Element = grid) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }),
    );
  return { scroller, grid, text, value, press };
}

describe("the grid", () => {
  it("has only the visible window of a 100 000-row sheet in the DOM, also after a scroll", () => {
    const { scroller, grid } = page();
    expect(grid.getAttribute("aria-rowcount")).toBe(String(ROWS + 1));
    expect(grid.getAttribute("aria-colcount")).toBe(String(COLS + 1));
    const cells = () => grid.querySelectorAll('[role="gridcell"]').length;
    const rows = () => grid.querySelectorAll('[role="row"]').length;
    expect(cells()).toBeGreaterThan(100);
    expect(cells()).toBeLessThan(2000);
    expect(rows()).toBeLessThan(80);
    expect(grid.querySelector('[aria-rowindex="2"] [role="gridcell"]')?.textContent).toBe("1");

    scroller.scrollTop = 50_000 * 20;
    scroller.dispatchEvent(new Event("scroll"));
    expect(cells()).toBeLessThan(2000);
    expect(grid.querySelector('[aria-rowindex="2"]')).toBeNull();
    const row = grid.querySelector('[aria-rowindex="50002"]');
    expect(row?.querySelector('[aria-colindex="2"]')?.textContent).toBe("50001");
  });

  it("arrows move the selection, Shift+arrows extend it, the formula bar follows", () => {
    const { grid, text, value, press } = page();
    expect(text("cell-address")).toBe("A1");
    press("ArrowDown");
    expect(text("cell-address")).toBe("A2");
    press("ArrowRight");
    expect([text("cell-address"), value("cell-content")]).toEqual(["B2", "row 2"]);
    press("ArrowRight", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(text("cell-address")).toBe("B2");
    expect(grid.querySelectorAll('[role="gridcell"][aria-selected="true"]')).toHaveLength(4);
    press("ArrowLeft");
    expect(text("cell-address")).toBe("A2");
    expect(grid.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    press("ArrowDown", { metaKey: true });
    expect(text("cell-address")).toBe(`A${ROWS}`);
    press("Home", { metaKey: true });
    expect(text("cell-address")).toBe("A1");
  });

  it("shows the formula and sums a range on the status line", () => {
    const { text, value, press } = page();
    const tab = [...document.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === "Small",
    );
    (tab as HTMLElement).click();
    expect(tab?.getAttribute("aria-selected")).toBe("true");
    expect(text("cell-address")).toBe("A1");
    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(text("stats")).toBe("Count 3 · Sum 6 · Average 2");
    for (let i = 0; i < 3; i++) press("ArrowDown");
    expect([text("cell-address"), value("cell-content")]).toEqual(["A4", "=SUM(A1:A3)"]);
    expect(text("stats")).toBe("");
  });

  it("Mod+F finds in the displayed values, Mod+G goes to the next match", () => {
    const { grid, text, press } = page();
    press("f", { metaKey: true });
    const input = document.getElementById("find-text") as HTMLInputElement;
    expect(document.getElementById("find")?.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
    input.value = "NEEDLE";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    press("Enter", {}, input);
    expect(text("cell-address")).toBe("C5");
    expect(text("find-count")).toBe("1 of 2");
    press("g", { metaKey: true }, input);
    expect(text("cell-address")).toBe("K70001");
    expect(text("find-count")).toBe("2 of 2");
    expect(grid.querySelector('[aria-rowindex="70002"]')).not.toBeNull();
    press("Escape", {}, input);
    expect(document.getElementById("find")?.hidden).toBe(true);
    expect(document.activeElement).toBe(grid);
  });

  it("never prevents the desk's chords", () => {
    const { press } = page();
    for (const key of ["s", "o", "w", "k"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.querySelector('[role="grid"]')?.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(false);
    }
    press("ArrowDown");
  });
});
