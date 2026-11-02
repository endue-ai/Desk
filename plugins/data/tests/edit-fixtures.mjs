// Fixtures for the edit tiers (ADR 0071): JSON and JSONC carrying every corner the syntax model must
// keep byte for byte (a BOM, CRLF, CR and mixed line endings, no final newline, tabs, escapes and
// their spellings, number spellings, duplicate keys, empty and deeply nested containers, comments
// and trailing commas), and YAML and TOML with comments for the text tier. Made-up values only. The
// tests import these functions; with a folder it writes the files there, with a 10 MiB JSON, for
// the live check and screenshots:
//
//   node plugins/data/tests/edit-fixtures.mjs /tmp/data-edit
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const encoder = new TextEncoder();
const BOM = "\ufeff";

/** @returns {Array<{ name: string, bytes: Uint8Array }>} The JSON and JSONC files, as bytes. */
export function jsonFixtures() {
  const deep = `${"[".repeat(120)}{"leaf": 1}${"]".repeat(120)}\n`;
  const files = {
    "pretty.json": [
      "{",
      '  "name": "Sample service",',
      '  "version": "1.0.0",',
      '  "price": 1.50,',
      '  "zero": -0,',
      '  "big": 12345678901234567890,',
      '  "exp": 1E+2,',
      '  "tiny": 0.1e-7,',
      '  "enabled": true,',
      '  "owner": null,',
      '  "quote": "She said \\"hi\\" \\\\ bye",',
      '  "lines": "one\\ntwo\\tthree",',
      '  "url": "https:\\/\\/example.invalid\\/a",',
      '  "accent": "caf\\u00e9 and café",',
      '  "emoji": "\\ud83d\\ude00 😀",',
      '  "empty": "",',
      '  "tags": ["alpha", "beta", 3, false, null],',
      '  "nested": { "list": [ { "id": 1 }, { "id": 2 } ], "none": {}, "nothing": [] },',
      '  "name": "Duplicate key, kept as written"',
      "}",
      "",
    ].join("\n"),
    "bom-crlf.json": `${BOM}{\r\n\t"title": "Tabs and CRLF",\r\n\t"count": 42,\r\n\t"ratio": 0.250\r\n}\r\n`,
    "mixed-endings.json": '[\r\n  "crlf",\n  "lf",\r  "cr",\r\n  1.0e3\n]',
    "minified.json": '{"a":1,"b":[true,false,null],"c":{"d":"e\\u0041"},"f":-12.5E-3}',
    "deep.json": deep,
    "scalar.json": '  "just one string"  \n\n',
    "ascii.json": '{ "word": "caf\\u00E9", "path": "a\\/b", "plain": "abc" }\n',
    "settings.jsonc": [
      "// Editor settings (made-up values)",
      "{",
      '  /* the theme */ "theme": "light", // after a value',
      '  "url": "http://example.invalid/not // a comment",',
      '  "size": 14,',
      '  "list": [1, 2, 3,],',
      "  /* a block",
      "     comment */",
      '  "last": false,',
      "}",
    ].join("\r\n"),
  };
  return Object.entries(files).map(([name, text]) => ({ name, bytes: encoder.encode(text) }));
}

/** @returns {Array<{ name: string, text: string }>} YAML and TOML files for the text tier. */
export function textFixtures() {
  return [
    {
      name: "service.yaml",
      text: [
        "# Service settings (made-up values)",
        "name: desk-sample   # the service name",
        "port: 8080",
        "debug: false",
        'greeting: "Hello, world"',
        "motto: 'it''s fine'",
        "base: &base 5",
        "copy: *base",
        "script: |",
        "  echo one",
        "  echo two",
        "tags:",
        "  - alpha",
        "  - beta # second",
        "",
      ].join("\n"),
    },
    {
      name: "app.toml",
      text: [
        "# App settings (made-up values)",
        'title = "Sample"  # the title',
        "",
        "[server]",
        "port = 8080",
        "path = 'C:\\data'",
        "ratio = 0.5",
        'hosts = ["one.invalid", "two.invalid"]',
        "started = 2026-11-02",
        "",
      ].join("\n"),
    },
  ];
}

/**
 * A JSON array of made-up records of at least `minimum` bytes, pretty-printed by hand with two
 * spaces and LF. Record `i` has the name `Record <i>`.
 * @param {number} minimum
 */
export function largeJson(minimum) {
  const parts = ["[\n"];
  let size = 2;
  for (let i = 0; size < minimum; i++) {
    const row = `${i ? ",\n" : ""}  {"id": ${i}, "name": "Record ${i}", "score": ${(i % 97) / 4}, "active": ${i % 2 === 0}, "note": "Generated sample row for the edit check."}`;
    parts.push(row);
    size += row.length;
  }
  parts.push("\n]\n");
  return encoder.encode(parts.join(""));
}

const folder = process.argv[2];
if (folder && import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(folder, { recursive: true });
  for (const { name, bytes } of jsonFixtures()) writeFileSync(join(folder, name), bytes);
  for (const { name, text } of textFixtures()) writeFileSync(join(folder, name), text);
  writeFileSync(join(folder, "large-10mb.json"), largeJson(10 * 1024 * 1024));
  console.log(`wrote the edit fixtures to ${folder}`);
}
