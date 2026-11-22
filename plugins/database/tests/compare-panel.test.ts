// @vitest-environment jsdom
// The comparison's panel (PG-26, ADR 0329), drawn from the state the feature keeps: the two results
// it compares, what the rows were paired by and why, the counts, the columns only one side has, and
// a row per difference with its changed cells marked in words and in the DOM (the value before, the
// value after); its buttons copy and export the difference.
import { describe, expect, it, vi } from "vitest";
import { compareSets } from "../ui/compare/diff.js";
import { comparePanel, stateOf } from "../ui/features/compare/panel.js";

const before = {
  columns: ["id", "item", "price"],
  rows: [
    ["1", "pen", "2.50"],
    ["2", "ink", "4.00"],
    ["3", "pad", null],
  ],
};
const after = {
  columns: ["id", "item", "price", "shelf"],
  rows: [
    ["1", "pen", "2.50", "A"],
    ["2", "ink", "4.40", "A"],
    ["5", "tape", "1.90", "B"],
  ],
};
const sides = {
  before: {
    label: "select * from stock · 10:00:00",
    console: "Notes",
    sql: "select * from stock",
    truncated: false,
  },
  after: { label: "Result", console: "Notes 2", sql: "select * from stock", truncated: true },
};

describe("the comparison's panel", () => {
  it("says the counts, the key, the one-side columns, and marks the changed cells", () => {
    const act = vi.fn();
    const state = stateOf(sides, compareSets(before, after, ["id"]), "primary");
    const panel = comparePanel(document, state, act);
    document.body.replaceChildren(panel);
    const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
    expect(text(".compare-sides")).toContain("Before: select * from stock · 10:00:00 (Notes)");
    expect(text(".compare-sides")).toContain("After: Result (Notes 2)");
    expect(text(".compare-count")).toBe(
      "Compared by the primary key (id): 1 changed, 1 added, 1 removed, 1 the same.",
    );
    expect(text(".compare-columns")).toBe("Only after: shelf. Not compared.");
    expect(text(".compare-note")).toBe(
      "The result after has more rows than it loaded: only the rows loaded are compared.",
    );
    const heads = [...document.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["Change", "id", "item", "price"]);
    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows.map((tr) => tr.className)).toEqual([
      "compare-changed",
      "compare-added",
      "compare-removed",
    ]);
    const changed = rows[0]?.querySelectorAll("td")[3];
    expect(changed?.className).toBe("compare-cell");
    expect(changed?.querySelector("del")?.textContent).toBe("4.00");
    expect(changed?.querySelector("ins")?.textContent).toBe("4.40");
    expect(changed?.getAttribute("aria-label")).toBe("price: 4.00, now 4.40");
    expect(rows[2]?.querySelectorAll("td")[3]?.textContent).toBe("NULL");
    (document.querySelector("[data-compare=copy]") as HTMLButtonElement).click();
    (document.querySelector("[data-compare=export]") as HTMLButtonElement).click();
    expect(act.mock.calls).toEqual([["copyDifference"], ["exportDifference"]]);
  });

  it("says when the rows were paired by position, and when only the first differences are kept", () => {
    const d = compareSets(before, after, null, { keep: 1 });
    const state = stateOf(sides, d, "default");
    document.body.replaceChildren(comparePanel(document, state, vi.fn()));
    expect(document.querySelector(".compare-count")?.textContent).toBe(
      "Compared by row position, as the results do not both carry a primary key: 2 changed, 0 added, 0 removed, 1 the same.",
    );
    expect(document.querySelector(".compare-kept")?.textContent).toBe(
      "Listed: the first 1 of 2 differences; copy and export hold the same.",
    );
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(document.querySelector("thead th:nth-child(2)")?.textContent).toBe("Row");
  });
});
