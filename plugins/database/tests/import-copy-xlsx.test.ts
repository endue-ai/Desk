// An `.xlsx` read for an import (PG-60) with the vendored spreadsheet reader (the database plugin's
// copy of ADR 0043's): the first sheet's rows, numbers as their digits, dates by their format as ISO
// text, booleans, empty cells as NULL, and its rows going out as COPY lines after the header.
import { describe, expect, it } from "vitest";
import { sampleOf, tableOf } from "../ui/import-copy/sample.js";
import { createTransform } from "../ui/import-copy/transform.js";
import { type Sheetjs, xlsxRows } from "../ui/import-copy/xlsx.js";
import * as XLSX from "../ui/vendor/sheetjs/xlsx.mjs";

const X = XLSX as unknown as Sheetjs & {
  utils: {
    aoa_to_sheet(rows: unknown[][], options?: Record<string, unknown>): Record<string, unknown>;
    book_new(): unknown;
    book_append_sheet(book: unknown, sheet: unknown, name: string): void;
  };
  write(book: unknown, options: Record<string, unknown>): ArrayBuffer;
};

/** A workbook of two sheets (the writer takes dates in local time), the first with a header, a date, a number, a boolean and a gap. */
function workbook() {
  const book = X.utils.book_new();
  const sheet = X.utils.aoa_to_sheet([
    ["id", "day", "price", "paid", "note"],
    [1, new Date(2026, 10, 23), 9.5, true, "first"],
    [2, new Date(2026, 10, 24, 13, 30), 10, false, null],
    [],
  ]);
  X.utils.book_append_sheet(book, sheet, "Sales");
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([["other"]]), "Other");
  return new Uint8Array(X.write(book, { type: "array", bookType: "xlsx" }));
}

describe("an .xlsx import", () => {
  it("reads the first sheet's rows as text, dates as ISO and empty cells as NULL", () => {
    expect(xlsxRows(X, workbook())).toEqual([
      ["id", "day", "price", "paid", "note"],
      ["1", "2026-11-23", "9.5", "true", "first"],
      ["2", "2026-11-24 13:30:00", "10", "false", null],
    ]);
  });

  it("samples its columns and sends its rows as COPY lines", () => {
    const bytes = workbook();
    const readers = { xlsx: (b: Uint8Array) => xlsxRows(X, b) };
    const options = {
      format: "xlsx" as const,
      encoding: "utf-8",
      delimiter: ",",
      quote: '"',
      escape: '"',
      nullText: "",
      trim: false,
      header: true,
      skip: 0,
    };
    const table = tableOf(sampleOf(options, bytes, true, readers), options);
    expect(table.columns).toEqual(["id", "day", "price", "paid", "note"]);
    const transform = createTransform({ ...options, keys: [], pick: [0, 2, 4] }, readers);
    transform.feed(bytes);
    transform.feed(null);
    expect(transform.take(1 << 20).text).toBe("1\t9.5\tfirst\n2\t10\t\\N\n");
  });

  it("refuses a file that is not a workbook", () => {
    expect(() => xlsxRows(X, new TextEncoder().encode("not a zip"))).toThrow(
      /not a workbook the import reads/u,
    );
  });
});
