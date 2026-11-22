// A whole export's text (PG-64): COPY's text format read back across any chunk end, every text
// format written in pieces exactly as the result's export writes all rows at once, the server's
// COPY taken only where its output is the file, and a file's pipe from pages to bytes.
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { copySql, directOf } from "../ui/copy/direct.js";
import { fieldOf, textReader } from "../ui/copy/text.js";
import { encodeText } from "../ui/export/bytes.js";
import { type ExportFormat, optionsOf } from "../ui/export/options.js";
import { createPipe } from "../ui/export/pipe.js";
import { textWriter } from "../ui/export/stream.js";
import { exportText } from "../ui/export/text.js";

type Row = (string | null)[];
const META = {
  columns: ["id", "name", "note"],
  oids: [23, 25, 25],
  types: ["integer", "text", "text"],
  table: "public.items",
};
const ROWS: Row[] = [
  ["1", "ada", null],
  ["2", 'say "hi", then\nleave', "tab\there"],
  ["3", "", "back\\slash"],
  ["4", "\\N", "é ü 漢"],
  ["5", "a|b", "<x & y>"],
  ["6", "NULL", "\u0001"],
  ["7", "seven", "last"],
];
/** COPY's text format of ROWS, as the server writes it. */
const COPY_TEXT =
  "1\tada\t\\N\n" +
  '2\tsay "hi", then\\nleave\ttab\\there\n' +
  "3\t\tback\\\\slash\n" +
  "4\t\\\\N\té ü 漢\n" +
  "5\ta|b\t<x & y>\n" +
  "6\tNULL\t\u0001\n" +
  "7\tseven\tlast\n";

const batches = <T>(all: T[], size: number) =>
  Array.from({ length: Math.ceil(all.length / size) }, (_, i) =>
    all.slice(i * size, i * size + size),
  );

describe("COPY's text format", () => {
  it("reads COPY's text format across chunk ends", () => {
    for (let cut = 1; cut < COPY_TEXT.length; cut += 3) {
      const reader = textReader();
      const rows = [
        ...reader.push(COPY_TEXT.slice(0, cut)),
        ...reader.push(COPY_TEXT.slice(cut)),
        ...reader.end(),
      ];
      expect(rows).toEqual(ROWS);
    }
    // A base64 page cut inside a UTF-8 character.
    const bytes = new TextEncoder().encode(COPY_TEXT);
    const at = Buffer.from(COPY_TEXT.slice(0, COPY_TEXT.indexOf("é"))).length + 1;
    const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
    const reader = textReader();
    const rows = [
      ...reader.push(b64(bytes.subarray(0, at)), "base64"),
      ...reader.push(b64(bytes.subarray(at)), "base64"),
      ...reader.end(),
    ];
    expect(rows).toEqual(ROWS);
    expect(fieldOf("\\b\\f\\v\\101\\x41\\q")).toBe("\b\f\vAAq");
  });
});

const FORMATS: Exclude<ExportFormat, "xlsx">[] = [
  "csv",
  "tsv",
  "json",
  "markdown",
  "insert",
  "update",
  "html",
  "xml",
  "template",
];

describe("a text format in pieces", () => {
  it("writes each format in pieces exactly as the whole-result export does", () => {
    for (const format of FORMATS) {
      for (const given of [
        {},
        {
          lineEnding: "crlf",
          header: true,
          batch: 3,
          row: "{{#}}. {{name}} ({{1}})",
          separator: ";",
          head: "BEGIN",
          foot: "END",
        },
      ]) {
        const options = optionsOf(
          format,
          format === "template" ? { row: "{{1}}", ...given } : given,
        );
        const set = { columns: META.columns, rows: ROWS, truncated: false, types: META.oids };
        const want = exportText(set, format, options, {
          dialect: "postgresql",
          types: META.types,
          table: META.table,
        });
        for (const size of [1, 2, 3, 5, 100]) {
          const w = textWriter(format, options, META);
          const got =
            w.head() +
            batches(ROWS, size)
              .map((b) => w.rows(b))
              .join("") +
            w.end();
          expect(got, `${format} ${JSON.stringify(given)} in ${size}s`).toBe(want);
        }
        const w = textWriter(format, options, META);
        const none = exportText({ ...set, rows: [] }, format, options, {
          dialect: "postgresql",
          types: META.types,
          table: META.table,
        });
        expect(w.head() + w.rows([]) + w.end(), `${format} empty`).toBe(none);
      }
    }
  });

  it("encodes in pieces as the whole file, the byte order mark once", async () => {
    for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
      const options = optionsOf("csv", { encoding, bom: true, lineEnding: "lf" });
      const set = { columns: META.columns, rows: ROWS, truncated: false };
      const whole = encodeText(exportText(set, "csv", options), options);
      const pipe = createPipe({ format: "csv", options, meta: META });
      const outs = [];
      for (let at = 0; at < COPY_TEXT.length; at += 11)
        outs.push(...(await pipe.push({ data: COPY_TEXT.slice(at, at + 11) })));
      outs.push(...(await pipe.end()));
      const bytes = Buffer.concat(
        outs.map((o) => Buffer.from(o.content, o.encoding === "base64" ? "base64" : "utf8")),
      );
      expect(bytes.toString("base64"), encoding).toBe(
        Buffer.from(whole.content, whole.encoding === "base64" ? "base64" : "utf8").toString(
          "base64",
        ),
      );
      expect(pipe.rows()).toBe(ROWS.length);
    }
  });

  it("passes the server's own bytes through, counting CSV rows outside quotes, gzipped when asked", async () => {
    const csv = 'id,name\n1,"two\nlines"\n2,""\n';
    const options = optionsOf("csv", { lineEnding: "lf", bom: true });
    for (const gzip of [false, true]) {
      const pipe = createPipe({ format: "csv", options, meta: META, direct: "csv", gzip });
      const outs = [
        ...(await pipe.push({ data: csv.slice(0, 13) })),
        ...(await pipe.push({ data: csv.slice(13) })),
        ...(await pipe.end()),
      ];
      let bytes = Buffer.concat(
        outs.map((o) => Buffer.from(o.content, o.encoding === "base64" ? "base64" : "utf8")),
      );
      if (gzip) bytes = gunzipSync(bytes);
      expect(bytes.toString("utf8")).toBe(`﻿${csv}`);
      expect(pipe.rows()).toBe(2);
    }
  });
});

describe("the server's COPY or the plugin's writer", () => {
  const meta = { columns: ["id", "name"], version: 170000 };
  it("takes the server's COPY only where its output matches", () => {
    const csv = (given: Record<string, unknown>) =>
      directOf("csv", optionsOf("csv", { lineEnding: "lf", ...given }), meta);
    expect(csv({})).toEqual({ format: "csv", delimiter: ",", header: true, null: "" });
    expect(csv({ delimiter: ";", header: false, null: "NA" })).toEqual({
      format: "csv",
      delimiter: ";",
      header: false,
      null: "NA",
    });
    expect(csv({ bom: true })).toBeDefined();
    expect(directOf("csv", optionsOf("csv", {}), meta)).toBeUndefined(); // CRLF by default
    expect(csv({ encoding: "utf-16le" })).toBeUndefined();
    expect(csv({ quote: "always" })).toBeUndefined();
    expect(csv({ quote: "never" })).toBeUndefined();
    expect(csv({ null: "a,b" })).toBeUndefined();
    expect(csv({ delimiter: "é" })).toBeUndefined();
    expect(
      directOf("csv", optionsOf("csv", { lineEnding: "lf" }), {
        columns: ["one"],
        version: 170000,
      }),
    ).toBeUndefined();
    const tsv = (given: Record<string, unknown>, version = 170000) =>
      directOf("tsv", optionsOf("tsv", given), { ...meta, version });
    expect(tsv({})).toEqual({ format: "text", delimiter: "\t", header: false, null: "\\N" });
    expect(tsv({ header: true }, 140000)).toBeUndefined();
    expect(tsv({ header: true }, 150000)).toBeDefined();
    expect(tsv({ null: "" })).toEqual({ format: "text", delimiter: "\t", header: false, null: "" });
    expect(tsv({ lineEnding: "crlf" })).toBeUndefined();
    for (const format of ["json", "xlsx", "insert"] as const)
      expect(directOf(format, optionsOf(format, {}), meta)).toBeUndefined();
    expect(
      copySql("select 1 -- why\n;", { format: "csv", delimiter: ";", header: true, null: "" }),
    ).toBe(
      "COPY (\nselect 1 -- why\n) TO STDOUT WITH (FORMAT csv, DELIMITER ';', NULL '', HEADER)",
    );
    expect(copySql("table items")).toBe("COPY (\ntable items\n) TO STDOUT");
    expect(copySql("t", { format: "text", delimiter: "\t", header: false, null: "\\N" })).toBe(
      "COPY (\nt\n) TO STDOUT WITH (FORMAT text, DELIMITER '\t', NULL E'\\\\N')",
    );
  });
});
