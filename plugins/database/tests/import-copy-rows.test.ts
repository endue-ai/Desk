// The import's streaming readers (PG-60): CSV with the person's delimiter, quote and escape and its
// records cut across pieces anywhere, PostgreSQL's text format, JSON lines, and the transform that
// turns them into COPY's text format with rows skipped, the header left out, values trimmed, the NULL
// text and the COPY's column order applied.
import { describe, expect, it } from "vitest";
import { createCsvReader } from "../ui/import-copy/csv.js";
import { createJsonLinesReader, createTextReader, keysOf } from "../ui/import-copy/lines.js";
import { copyLine, createTransform, type Job } from "../ui/import-copy/transform.js";

const CSV = { delimiter: ",", quote: '"', escape: '"', nullText: "", trim: false };
type Reader = { push(text: string): (string | null)[][]; end(): (string | null)[][] };

/** Feed `text` in pieces of `size` characters and gather every record. */
function readAll(reader: Reader, text: string, size: number) {
  const rows: (string | null)[][] = [];
  for (let at = 0; at < text.length; at += size)
    rows.push(...reader.push(text.slice(at, at + size)));
  rows.push(...reader.end());
  return rows;
}

describe("the CSV reader", () => {
  const text =
    'id,name,note\r\n1,"O\'Brien, Pat","said ""hi""\nand left"\r\n2,,""\r\n\r\n3,Zoë,end';
  const expected = [
    ["id", "name", "note"],
    ["1", "O'Brien, Pat", 'said "hi"\nand left'],
    ["2", null, ""],
    ["3", "Zoë", "end"],
  ];

  it("reads the same records whatever the pieces are cut at", () => {
    for (const size of [1, 2, 3, 5, 7, 64, text.length])
      expect(readAll(createCsvReader(CSV), text, size), `pieces of ${size}`).toEqual(expected);
  });

  it("takes another delimiter, quote and escape", () => {
    const reader = createCsvReader({ ...CSV, delimiter: ";", quote: "'", escape: "\\" });
    expect(readAll(reader, "a;'b\\'c;d'\n'x\\\\y';z\n", 3)).toEqual([
      ["a", "b'c;d"],
      ["x\\y", "z"],
    ]);
  });

  it("reads the NULL text and trims the spaces around values", () => {
    const reader = createCsvReader({ ...CSV, nullText: "NULL", trim: true });
    expect(readAll(reader, ' a , NULL ,"NULL", \n', 4)).toEqual([["a", null, "NULL", ""]]);
  });

  it("refuses a file that ends inside quotes", () => {
    const reader = createCsvReader(CSV);
    reader.push('1,"open');
    expect(() => reader.end()).toThrow(/ends inside a quoted field/u);
  });
});

describe("the line readers", () => {
  it("reads PostgreSQL's text format with its escapes and \\N", () => {
    const reader = createTextReader({ delimiter: "\t", nullText: "", trim: false });
    expect(readAll(reader, "1\ta\\tb\\\\c\t\\N\r\n2\tline\\nbreak\tx\n", 4)).toEqual([
      ["1", "a\tb\\c", null],
      ["2", "line\nbreak", "x"],
    ]);
  });

  it("reads JSON lines of objects by the sample's keys, and of arrays in order", () => {
    const text = '{"id":1,"tags":["a"],"name":"Ann"}\n{"name":"Bo","id":2}\n\n[3,null,"x"]\n';
    expect(keysOf(text)).toEqual(["id", "tags", "name"]);
    const reader = createJsonLinesReader({ columns: keysOf(text), trim: false });
    expect(readAll(reader, text, 5)).toEqual([
      ["1", '["a"]', "Ann"],
      ["2", null, "Bo"],
      ["3", null, "x"],
    ]);
  });

  it("says which line is not JSON", () => {
    const reader = createJsonLinesReader({ columns: ["a"], trim: false });
    expect(() => reader.push('{"a":1}\n{oops}\n')).toThrow(/^Line 2 is not JSON/u);
  });
});

describe("COPY lines", () => {
  it("writes a row in COPY's text format, its values in the COPY's order", () => {
    expect(copyLine(["a\tb", null, "c\\d\ne\r"], [2, 0, 1])).toBe("c\\\\d\\ne\\r\ta\\tb\t\\N\n");
  });

  it("skips rows and the header, picks the columns, and hands out bounded pieces", () => {
    const job: Job = {
      format: "csv",
      encoding: "utf-8",
      ...CSV,
      header: true,
      skip: 1,
      keys: [],
      pick: [1, 0],
    };
    const transform = createTransform(job);
    const bytes = new TextEncoder().encode("a title line\nid,name\n1,Ann\n2,Bo\n3,Cy\n");
    transform.feed(bytes.subarray(0, 20));
    transform.feed(bytes.subarray(20));
    transform.feed(null);
    expect(transform.take(1024, 2)).toEqual({ text: "Ann\t1\nBo\t2\n", rows: 2, bytes: 11 });
    expect(transform.take(1024)).toEqual({ text: "Cy\t3\n", rows: 1, bytes: 5 });
    expect(transform.ready()).toBe(false);
    expect(transform.ended()).toBe(true);
  });

  it("decodes a character cut between two pieces", () => {
    const job: Job = {
      format: "tsv",
      encoding: "utf-8",
      ...CSV,
      delimiter: "\t",
      header: false,
      skip: 0,
      keys: [],
      pick: [0],
    };
    const transform = createTransform(job);
    const bytes = new TextEncoder().encode("Zoë\n");
    transform.feed(bytes.subarray(0, 3));
    transform.feed(bytes.subarray(3));
    transform.feed(null);
    expect(transform.take(1024)).toEqual({ text: "Zoë\n", rows: 1, bytes: 5 });
  });

  it("refuses an encoding it cannot read", () => {
    const job: Job = {
      format: "csv",
      encoding: "no-such",
      ...CSV,
      header: false,
      skip: 0,
      keys: [],
      pick: [0],
    };
    expect(() => createTransform(job)).toThrow(/encoding no-such is not one the import reads/u);
  });
});
