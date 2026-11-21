// Reading a paste (PG-43, #470): the grid's own copy (tab-separated with PostgreSQL's escapes, \N for
// NULL) back to the values it copied, a spreadsheet's tab-separated text with quoted fields, CSV when
// every line splits alike, and one value as one value.
import { describe, expect, it } from "vitest";
import { readPaste } from "../ui/edit/paste-text.js";
import { formatRows } from "../ui/results.js";

describe("reading a paste", () => {
  it("reads the grid's own copy back to the values it copied", () => {
    const rows = [
      ["1", "tab\there", null],
      ["2", "line\nbreak\r\nand back\\slash", ""],
      ["3", "\\N", "plain"],
    ];
    const set = { columns: ["id", "note", "more"], rows, truncated: false };
    const text = formatRows(set, "tsv");
    expect(readPaste(text, { ours: true })).toEqual({ rows, format: "copy" });
    // One cell of the grid's copy is one value, with its escapes read.
    expect(readPaste("a\\tb", { ours: true })).toEqual({ rows: [["a\tb"]], format: "value" });
    expect(readPaste("\\N", { ours: true }).rows).toEqual([[null]]);
  });

  it("reads a spreadsheet's tab-separated text with quoted fields and one final line break", () => {
    const text = 'a\t"two\nlines"\tc\r\n"say ""hi"""\t\tC:\\new\n"tab\there"\tx\ty\n';
    expect(readPaste(text)).toEqual({
      rows: [
        ["a", "two\nlines", "c"],
        ['say "hi"', "", "C:\\new"],
        ["tab\there", "x", "y"],
      ],
      format: "tsv",
    });
    // \N alone is NULL in any tab-separated text; other backslashes stay as they are.
    expect(readPaste("\\N\tC:\\temp").rows).toEqual([[null, "C:\\temp"]]);
    // A quote inside a field that does not start with one is text.
    expect(readPaste('5" pipe\tx').rows).toEqual([['5" pipe', "x"]]);
  });

  it("reads CSV only when every line splits into the same number of fields", () => {
    expect(readPaste('id,name\r\n1,"Lee, Ann"\r\n2,\r\n3,""\r\n')).toEqual({
      rows: [
        ["id", "name"],
        ["1", "Lee, Ann"],
        ["2", null],
        ["3", ""],
      ],
      format: "csv",
    });
    // Lines that split unevenly are one value each: one column.
    expect(readPaste("Seoul, Korea\nBusan\nDaegu, Korea, East")).toEqual({
      rows: [["Seoul, Korea"], ["Busan"], ["Daegu, Korea, East"]],
      format: "tsv",
    });
  });

  it("keeps one value whole: commas, spaces and one final line break", () => {
    expect(readPaste("Seoul, Korea")).toEqual({ rows: [["Seoul, Korea"]], format: "value" });
    expect(readPaste("  42 \n")).toEqual({ rows: [["  42 "]], format: "value" });
    expect(readPaste("")).toEqual({ rows: [[""]], format: "value" });
  });

  it("reads lines without a tab as one column, a line of tabs as one row", () => {
    expect(readPaste("a\nb\n\nd").rows).toEqual([["a"], ["b"], [""], ["d"]]);
    expect(readPaste("a\tb\tc").rows).toEqual([["a", "b", "c"]]);
    expect(readPaste("a\t\t").rows).toEqual([["a", "", ""]]);
  });
});
