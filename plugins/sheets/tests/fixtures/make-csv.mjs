#!/usr/bin/env node
// Makes the CSV and TSV fixtures of lossless editing (ADR 0071) byte for byte: the corners a saved
// file must keep (a UTF-8 BOM, CRLF, LF, CR and mixed line endings, no final newline, quoted fields
// with delimiters, doubled quotes and line breaks, text after a closing quote, empty fields, ragged
// rows). No personal data. Run from anywhere: node plugins/sheets/tests/fixtures/make-csv.mjs
// The 100 000-row file is not committed: the tests call `large()`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BOM = "﻿";

/** Each fixture's name and its text; written as UTF-8. */
export const FIXTURES = {
  // As Excel saves "CSV UTF-8": a BOM, CRLF, quotes where a field needs them, and one tool's habit
  // of quoting text that does not need it.
  "crlf-bom-quotes.csv": [
    `${BOM}city,country,population,note\r\n`,
    `"Seoul, KR",Korea,9.7,"capital"\r\n`,
    `Busan,Korea,3.4,"a ""port"" city"\r\n`,
    `"Incheon",Korea,"3,000,000","two\r\nlines"\r\n`,
    "Daegu,,2.4,\r\n",
  ].join(""),
  // Tab-separated rows of four, three, two, five, one and three fields; no final newline.
  "ragged.tsv": [
    "id\tname\tqty\tunit\n",
    "1\tbolt\t40\n",
    "2\tnut\n",
    "3\twasher\t250\tpcs\textra\n",
    "\n",
    '4\t"quoted\ttab"\t7',
  ].join(""),
  // LF, CRLF and CR in one file, a line break inside quotes, text after a closing quote, a row of
  // empty fields, and a CR at the very end.
  "mixed-endings.csv": [
    "name,value\n",
    "alpha,1\r\n",
    "beta,2\r",
    '"gamma\nwith a break",3\n',
    '"it"s,5\n',
    ",\r\n",
    'delta,"4"\r',
  ].join(""),
};

/**
 * `rows` rows after a header, as a spreadsheet exports them: a BOM, CRLF, every seventh note quoted
 * for its comma and every eleventh for its quotes.
 * @param {number} [rows]
 */
export function large(rows = 100_000) {
  const lines = [`${BOM}id,item,amount,note\r\n`];
  for (let i = 1; i <= rows; i++) {
    const note = i % 7 === 0 ? '"boxed, fragile"' : i % 11 === 0 ? '"say ""when"""' : "";
    lines.push(`${i},item ${i},${(i * 1.25).toFixed(2)},${note}\r\n`);
  }
  return new TextEncoder().encode(lines.join(""));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const [name, text] of Object.entries(FIXTURES)) {
    writeFileSync(join(here, name), text);
    console.log(`wrote ${name}`);
  }
}
