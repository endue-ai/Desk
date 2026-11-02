// CSV and TSV saved byte for byte (ADR 0071): the concrete-syntax model round-trips every fixture,
// an edit changes only its cell's bytes, and the model's fields are the cells the grid shows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertMinimalEdit,
  assertRoundTrip,
} from "../../../packages/plugin-sdk/src/testing/round-trip";
import { decode, parseCsv } from "../ui/csv.js";
import { createCsvDoc } from "../ui/csv-edit.js";
import { fieldIndex, fieldText, parseSyntax, rowLength, serialize } from "../ui/csv-syntax.js";
import { FIXTURES, large } from "./fixtures/make-csv.mjs";
import { fixture } from "./harness";

const NAMES = ["crlf-bom-quotes.csv", "ragged.tsv", "mixed-endings.csv"] as const;
const delimiterOf = (name: string) => (name.endsWith(".tsv") ? "\t" : ",");
const parser = (delimiter: string) => (bytes: Uint8Array) => parseSyntax(bytes, delimiter);

/** A document over a fixture, with each edit applied and checked to change something. */
function edited(name: (typeof NAMES)[number], edits: Array<[number, number, string]>) {
  const doc = createCsvDoc(parseSyntax(fixture(name), delimiterOf(name)));
  for (const [r, c, text] of edits) expect(doc.set(r, c, text), `${r},${c}`).toBe("changed");
  return doc;
}

describe("the CSV and TSV fixtures", () => {
  it("are what make-csv.mjs writes", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      const committed = readFileSync(join(import.meta.dirname, "fixtures", name));
      expect(new Uint8Array(committed), name).toEqual(new TextEncoder().encode(FIXTURES[name]));
    }
  });
});

describe("the concrete-syntax model", () => {
  it.each(NAMES)("round-trips %s byte for byte", (name) => {
    const syntax = assertRoundTrip(fixture(name), parser(delimiterOf(name)), (s) => serialize(s));
    expect(syntax.rows).toBeGreaterThan(3);
  });

  it("round-trips an empty file, one blank line and a lone quoted field", () => {
    for (const text of ["", "\n", "\r\n", '""', 'a\n""', "a,", ",\r", "﻿", "﻿a"]) {
      const syntax = assertRoundTrip(text, parser(","), (s) => serialize(s));
      const rows = parseCsv(text.replace(/^﻿/u, ""), ",");
      expect(syntax.rows, JSON.stringify(text)).toBe(rows.length);
    }
  });

  it("round-trips 100 000 generated rows and edits one cell in the middle", () => {
    const bytes = large(100_000);
    const syntax = assertRoundTrip(bytes, parser(","), (s) => serialize(s));
    expect(syntax.rows).toBe(100_001);
    const doc = createCsvDoc(syntax);
    expect(doc.set(50_000, 1, "widget, large")).toBe("changed");
    assertMinimalEdit(bytes, doc.save().bytes, {
      find: "\r\n50000,item 50000,",
      bytes: '\r\n50000,"widget, large",',
    });
  });

  it.each(NAMES)("has the fields the grid shows for %s", (name) => {
    const bytes = fixture(name);
    const rows = parseCsv(decode(bytes).text, delimiterOf(name));
    const syntax = parseSyntax(bytes, delimiterOf(name));
    expect(syntax.rows).toBe(rows.length);
    rows.forEach((row, r) => {
      expect(rowLength(syntax, r), `row ${r}`).toBe(row.length);
      row.forEach((text, c) => {
        expect(fieldText(syntax, fieldIndex(syntax, r, c))).toBe(text);
      });
    });
    expect(fieldIndex(syntax, 0, rows[0]?.length ?? 0)).toBe(-1);
    expect(fieldIndex(syntax, rows.length, 0)).toBe(-1);
  });
});

describe("an edit", () => {
  it("changes only its cell's bytes and keeps each field's quoting", () => {
    const bytes = fixture("crlf-bom-quotes.csv");
    const doc = edited("crlf-bom-quotes.csv", [
      [1, 0, "Seoul, South Korea"], // quoted, stays quoted
      [1, 3, "capital city"], // quoted without need, stays quoted
      [2, 0, 'Busan "the port"'], // unquoted, gains quotes for its quotes
      [2, 2, "3.5"], // unquoted, stays unquoted
      [3, 3, "one\r\nline more"], // quoted with a line break, keeps the file's CRLF elsewhere
      [4, 1, "Korea"], // an empty field
    ]);
    assertMinimalEdit(bytes, doc.save().bytes, [
      { find: '"Seoul, KR"', bytes: '"Seoul, South Korea"' },
      { find: '"capital"', bytes: '"capital city"' },
      { find: "\r\nBusan,", bytes: '\r\n"Busan ""the port""",' },
      { find: ",3.4,", bytes: ",3.5," },
      { find: '"two\r\nlines"', bytes: '"one\r\nline more"' },
      { find: "Daegu,,", bytes: "Daegu,Korea," },
    ]);
    expect(doc.save().bytes.subarray(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
  });

  it("adds quotes for the delimiter in a TSV and keeps its rows ragged", () => {
    const bytes = fixture("ragged.tsv");
    const doc = edited("ragged.tsv", [
      [2, 1, "nut\tM6"],
      [3, 4, "spare"],
      [5, 1, "plain"],
      [5, 2, "8"],
    ]);
    assertMinimalEdit(bytes, doc.save().bytes, [
      { find: "\tnut\n", bytes: '\t"nut\tM6"\n' },
      { find: "extra", bytes: "spare" },
      { find: '"quoted\ttab"', bytes: '"plain"' },
      { find: "\t7", bytes: "\t8" },
    ]);
  });

  it("keeps LF, CRLF and CR where they were, and the CR at the end", () => {
    const bytes = fixture("mixed-endings.csv");
    const doc = edited("mixed-endings.csv", [
      [2, 1, "20"],
      [4, 0, "it is"],
      [5, 0, "empty"],
      [6, 1, "40"],
    ]);
    const after = doc.save().bytes;
    assertMinimalEdit(bytes, after, [
      { find: "beta,2\r", bytes: "beta,20\r" },
      { find: '"it"s', bytes: '"it is"' },
      { find: "\n,\r\n", bytes: "\nempty,\r\n" },
      { find: '"4"\r', bytes: '"40"\r' },
    ]);
    expect(after.at(-1)).toBe(0x0d);
  });

  it("only edits the file's own cells, and setting a cell back drops its edit", () => {
    const bytes = fixture("ragged.tsv");
    const doc = createCsvDoc(parseSyntax(bytes, "\t"));
    expect(doc.set(2, 2, "x")).toBe("outside"); // past the row's last field
    expect(doc.set(6, 0, "x")).toBe("outside"); // below the last row
    expect(doc.set(1, 1, "bolt")).toBe("same");
    expect(doc.modified).toBe(false);
    expect(doc.set(1, 1, "screw")).toBe("changed");
    expect([doc.modified, doc.text(1, 1)]).toEqual([true, "screw"]);
    expect(doc.set(1, 1, "bolt")).toBe("changed");
    expect(doc.modified).toBe(false);
    expect(doc.save().bytes).toEqual(bytes);
  });

  it("a save becomes the new file; edits made while it was written stay unsaved", () => {
    const bytes = fixture("crlf-bom-quotes.csv");
    const doc = createCsvDoc(parseSyntax(bytes, ","));
    doc.set(2, 0, "Busan, KR");
    const first = doc.save();
    doc.set(4, 0, "Daejeon");
    first.commit();
    expect(doc.modified).toBe(true);
    expect([doc.text(2, 0), doc.text(4, 0)]).toEqual(["Busan, KR", "Daejeon"]);
    const second = doc.save();
    assertMinimalEdit(first.bytes, second.bytes, { find: "Daegu", bytes: "Daejeon" });
    second.commit();
    expect(doc.modified).toBe(false);
    // The quotes the first save added are the field's quoting now.
    expect(doc.set(2, 0, "Busan")).toBe("changed");
    assertMinimalEdit(second.bytes, doc.save().bytes, { find: '"Busan, KR"', bytes: '"Busan"' });
  });
});
