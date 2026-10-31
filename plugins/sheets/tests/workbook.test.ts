// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type Book, openBook, type Sheet } from "../ui/book.js";
import { fixture } from "./harness";

/** budget.source.xml, written by LibreOffice in each format (tests/fixtures/make.sh). */
const open = (name: string, as = name) => openBook(fixture(name), { name: as });

const sheets = (book: Book): Sheet[] => {
  if (book.kind !== "sheets") throw new Error(`${book.kind}: ${JSON.stringify(book)}`);
  return book.sheets;
};

const BUDGET = {
  text: [
    ["Quarterly budget", "", "", ""],
    ["Item", "Amount", "Share", "Due"],
    ["Rent", "$1,200.00", "50.0%", "2026-01-15"],
    ["Power", "$300.50", "12.5%", "2026-02-01"],
    ["Water", "$99.25", "37.5%", "2026-03-10"],
    ["Total", "$1,599.75", "100.0%", "TRUE"],
  ],
  values: [
    [2, 1, 1200],
    [3, 1, 300.5],
    [4, 2, 0.375],
    [5, 1, 1599.75],
  ],
};

const textOf = (sheet: Sheet, rows: number, cols: number) =>
  Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => sheet.text(r, c)));

describe.each(["budget.xlsx", "budget.xls", "budget.ods", "budget.fods"])("%s", (name) => {
  it("has the visible sheets, the values and the text as the file formats it", () => {
    const [budget, notes, ...rest] = sheets(open(name));
    expect([budget?.name, notes?.name, rest.length]).toEqual(["Budget", "Notes", 0]);
    if (!budget || !notes) return;
    expect(textOf(budget, 6, 4)).toEqual(BUDGET.text);
    for (const [r = 0, c = 0, value] of BUDGET.values) expect(budget.cell(r, c)?.v).toBe(value);
    expect(notes.text(1, 1)).toBe("가격");
    expect(notes.text(3, 1)).toBe("合計");
  });

  it("keeps formulas, merges, hidden rows and columns, sizes and frozen panes", () => {
    const [budget] = sheets(open(name));
    if (!budget) return;
    expect(budget.input(5, 1)).toBe("=SUM(B3:B5)");
    expect(budget.input(5, 2)).toBe("=SUM(C3:C5)");
    expect(budget.input(2, 1)).toBe("1200");
    expect(budget.input(2, 2)).toBe("50%");
    expect(budget.input(2, 0)).toBe("Rent");
    expect(budget.merges).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 7, c: 0 }, e: { r: 7, c: 1 } },
    ]);
    expect(budget.hiddenRow(6)).toBe(true);
    expect(budget.hiddenRow(5)).toBe(false);
    expect(budget.hiddenCol(4)).toBe(true);
    expect(budget.hiddenCol(3)).toBe(false);
    expect(budget.width(0)).toBeGreaterThan(budget.width(2));
    expect(budget.height(0)).toBe(32);
    expect(budget.height(7)).toBe(40);
    if (name !== "budget.xls") expect(budget.frozen).toEqual({ rows: 2, cols: 1 });
  });
});

describe("budget.csv", () => {
  it("has the same sheet, values and formatted text, without formulas or merges", () => {
    const book = open("budget.csv", "Budget.csv");
    const [budget, ...rest] = sheets(book);
    expect([budget?.name, rest.length]).toEqual(["Budget", 0]);
    if (!budget) return;
    expect(textOf(budget, 6, 4)).toEqual(BUDGET.text);
    for (const [r = 0, c = 0, value] of BUDGET.values) expect(budget.cell(r, c)?.v).toBe(value);
    expect(budget.input(5, 1)).toBe("1599.75");
    expect(budget.merges).toEqual([]);
    expect(budget.frozen).toEqual({ rows: 0, cols: 0 });
    expect(book).toMatchObject({ format: "Comma-separated values", detail: "UTF-8, comma" });
  });
});

describe("the older and plainer formats", () => {
  it.each(["budget.dif", "budget.slk"])("%s opens with its values", (name) => {
    const [sheet, ...rest] = sheets(open(name));
    expect(rest).toHaveLength(0);
    expect(sheet?.text(1, 1)).toBe("Amount");
    expect(sheet?.cell(2, 1)?.v).toBe(1200);
  });

  it("SYLK keeps the formula", () => {
    const [sheet] = sheets(open("budget.slk"));
    expect(sheet?.input(5, 1)).toBe("=SUM(B3:B5)");
  });
});
