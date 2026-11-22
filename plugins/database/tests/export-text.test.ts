// @vitest-environment jsdom
// An export's text formats with their options (PG-61, ui/export/text.js and options.js): CSV and TSV
// with a delimiter, quoting, a header, the text for NULL and a line ending, the defaults writing
// what the six formats always wrote; an HTML table and XML read back to the same values and NULLs;
// the person's template; INSERT in batches; options checked with a sentence.
import { describe, expect, it } from "vitest";
import { defaultsOf, optionsOf } from "../ui/export/options.js";
import { exportText } from "../ui/export/text.js";
import { formatRows } from "../ui/results.js";

const set = {
  columns: ["id", "label", "note"],
  rows: [
    ["1", 'say "hi"; then\r\nleave', null],
    ["2", "a\tb\\c", ""],
    ["3", "NULL", "x;y"],
  ] as (string | null)[][],
  truncated: false,
};

describe("delimited options", () => {
  it("the defaults write what CSV, TSV, JSON, Markdown, INSERT and UPDATE wrote before", () => {
    const end = (format: "tsv" | "json" | "markdown" | "insert" | "update", eol = "\n") =>
      `${formatRows(set, format, { table: '"t"' })}${eol}`;
    expect(exportText(set, "csv", defaultsOf("csv"))).toBe(`${formatRows(set, "csv")}\r\n`);
    for (const format of ["tsv", "json", "markdown", "insert", "update"] as const)
      expect(exportText(set, format, defaultsOf(format), { table: '"t"' })).toBe(end(format));
  });

  it("writes CSV with another delimiter, quoting as asked, and NULL as its text", () => {
    const csv = (given: Record<string, unknown>) =>
      exportText(set, "csv", optionsOf("csv", given)).split("\r\n");
    expect(csv({ delimiter: ";", null: "NULL" })).toEqual([
      "id;label;note",
      '1;"say ""hi""; then',
      'leave";NULL',
      "2;a\tb\\c;",
      '3;"NULL";"x;y"',
      "",
    ]);
    expect(csv({ quote: "always", header: false })).toEqual([
      '"1","say ""hi""; then',
      'leave",',
      '"2","a\tb\\c",""',
      '"3","NULL","x;y"',
      "",
    ]);
    expect(csv({ quote: "never", delimiter: "|" })[3]).toBe("2|a\tb\\c|");
    expect(exportText(set, "csv", optionsOf("csv", { lineEnding: "lf" })).split("\n")[0]).toBe(
      "id,label,note",
    );
  });

  it("writes TSV with a header, another NULL and the delimiter escaped", () => {
    expect(
      exportText(set, "tsv", optionsOf("tsv", { header: true, null: "", lineEnding: "crlf" })),
    ).toBe(
      'id\tlabel\tnote\r\n1\tsay "hi"; then\\r\\nleave\t\r\n2\ta\\tb\\\\c\t\r\n3\tNULL\tx;y\r\n',
    );
    expect(exportText(set, "tsv", optionsOf("tsv", { delimiter: ";" })).split("\n")[2]).toBe(
      "3;NULL;x\\;y",
    );
  });

  it("checks options and says what is wrong", () => {
    expect(() => optionsOf("csv", { delimiter: "ab" })).toThrow(/one character/u);
    expect(() => optionsOf("csv", { delimiter: '"' })).toThrow(/not a quote/u);
    expect(() => optionsOf("csv", { quote: "maybe" })).toThrow(/needed, always, never/u);
    expect(() => optionsOf("insert", { batch: 0 })).toThrow(/1 to 10000/u);
    expect(() => optionsOf("template", {})).toThrow(/needs a row/u);
    expect(optionsOf("csv", { delimiter: "\\t" }).delimiter).toBe("\t");
    // Options another format reads are dropped.
    expect(optionsOf("json", { delimiter: ";" })).toEqual(defaultsOf("json"));
  });
});

describe("HTML, XML and the person's template", () => {
  it("writes an HTML table that reads back to the same values and NULLs", () => {
    const text = exportText(set, "html", defaultsOf("html"));
    const doc = new DOMParser().parseFromString(text, "text/html");
    expect([...doc.querySelectorAll("th")].map((th) => th.textContent)).toEqual(set.columns);
    const rows = [...doc.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) =>
        td.hasAttribute("data-null") ? null : td.textContent,
      ),
    );
    expect(rows).toEqual(set.rows);
    expect(doc.querySelector("td[data-null]")?.textContent).toBe("NULL");
    expect(exportText(set, "html", optionsOf("html", { header: false }))).not.toContain("<th>");
  });

  it("writes XML that reads back exactly, a control character as base64", () => {
    const odd = { ...set, rows: [...set.rows, ["4", "bell\u0007<&>", "\r"]] };
    const text = exportText(odd, "xml", defaultsOf("xml"));
    const doc = new DOMParser().parseFromString(text, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const rows = [...doc.getElementsByTagName("row")].map((row) =>
      [...row.getElementsByTagName("value")].map((v) => {
        if (v.getAttribute("null") === "true") return null;
        const raw = v.textContent ?? "";
        return v.getAttribute("encoding") === "base64"
          ? new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)))
          : raw;
      }),
    );
    expect(rows).toEqual(odd.rows);
    expect(doc.getElementsByTagName("value")[1]?.getAttribute("column")).toBe("label");
  });

  it("writes each row through the template's placeholders", () => {
    const options = optionsOf("template", {
      head: "[",
      row: '  {"n": {{#}}, "id": {{ id }}, "note": "{{3}}"}',
      separator: ",",
      foot: "]",
      null: "none",
    });
    expect(exportText(set, "template", options)).toBe(
      '[\n  {"n": 1, "id": 1, "note": "none"},\n  {"n": 2, "id": 2, "note": ""},\n  {"n": 3, "id": 3, "note": "x;y"}\n]\n',
    );
    expect(() => exportText(set, "template", optionsOf("template", { row: "{{price}}" }))).toThrow(
      "Export: the template's {{price}} names no column of the result.",
    );
  });

  it("writes INSERT in batches of the size asked, into the table named", () => {
    const options = optionsOf("insert", { batch: 2, table: "archive.notes", lineEnding: "crlf" });
    expect(exportText(set, "insert", options, { dialect: "postgresql" })).toBe(
      [
        'INSERT INTO archive.notes ("id", "label", "note") VALUES',
        "  (1, 'say \"hi\"; then\r\nleave', NULL),",
        "  (2, E'a\tb\\\\c', '');",
        'INSERT INTO archive.notes ("id", "label", "note") VALUES',
        "  (3, 'NULL', 'x;y');",
        "",
      ].join("\r\n"),
    );
    // The result's own table when none is named.
    expect(exportText(set, "update", defaultsOf("update"), { table: '"t"', key: [0] })).toContain(
      'UPDATE "t" SET',
    );
  });
});
