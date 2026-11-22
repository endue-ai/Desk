// An .xlsx workbook of results (PG-61), written by the plugin: the package's parts (content types,
// relationships, the workbook, its styles and one worksheet per result) in a zip (zip.js). Cells
// are typed (cells.js); text goes inline (no shared strings), its control characters as `_xHHHH_`
// as the format asks; the header row is bold and stays in sight. Sheet names are made safe and
// unique. Past the format's limits (1,048,576 rows, 16,384 columns, 32,767 characters a cell) it
// refuses with a sentence. No DOM.

import { cellOf, kindsOf } from "./cells.js";
import { replaceUnsafe } from "./chars.js";
import { zip } from "./zip.js";

/**
 * @typedef {{ name: string, columns: string[], rows: (string | null)[][], oids?: (number | undefined)[], types?: (string | undefined)[] }} Sheet
 *   `oids`: each column's PostgreSQL type; `types`: its declared type's name.
 */

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006";
const TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;
export const MAX_TEXT = 32_767;

const escapeXml = (/** @type {string} */ s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Text as a cell's: escaped, a literal `_xHHHH_` kept, control characters and CR as `_xHHHH_`. */
export const cellText = (/** @type {string} */ s) =>
  escapeXml(
    replaceUnsafe(
      s.replace(/_(x[0-9A-Fa-f]{4}_)/gu, "_x005F_$1"),
      (unit) => `_x${unit.toString(16).toUpperCase().padStart(4, "0")}_`,
      true,
    ),
  );

/** A column's letters: 0 is A, 26 is AA. */
export function columnName(/** @type {number} */ index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Sheet names a workbook takes: no `[]:*?/\`, 31 characters at most, unique ignoring case. */
export function sheetNames(/** @type {string[]} */ wanted) {
  const seen = new Set();
  return wanted.map((name, i) => {
    const base =
      name
        .replace(/[[\]:*?/\\\p{Cc}]/gu, " ")
        .replace(/^'+|'+$/gu, "")
        .trim()
        .slice(0, 31) || `Result ${i + 1}`;
    let out = base;
    for (let n = 2; seen.has(out.toLowerCase()); n++)
      out = `${base.slice(0, 31 - ` (${n})`.length)} (${n})`;
    seen.add(out.toLowerCase());
    return out;
  });
}

/** A sheet's rows as XML, the first numbered `first` (1-based); a cell past the format's limit refuses. */
export function rowsXml(
  /** @type {{ name: string, columns: string[] }} */ sheet,
  /** @type {(string | null)[][]} */ rows,
  /** @type {number} */ first,
  /** @type {import("./cells.js").Kind[]} */ kinds,
  /** @type {{ null: string }} */ o,
) {
  const count = sheet.columns.length;
  const letters = sheet.columns.map((_, c) => columnName(c));
  let out = "";
  rows.forEach((row, r) => {
    const n = first + r;
    let cells = "";
    for (let c = 0; c < count; c++) {
      const cell = cellOf(row[c] ?? null, kinds[c] ?? "text", o.null);
      if (!cell) continue;
      const ref = `${letters[c]}${n}`;
      if (cell.t === "n") cells += `<c r="${ref}"><v>${cell.v}</v></c>`;
      else if (cell.t === "d") cells += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      else cells += textCell(sheet.name, ref, cell.v);
    }
    out += `<row r="${n}">${cells}</row>`;
  });
  return out;
}

/** An inline text cell; past 32,767 characters it refuses. */
function textCell(
  /** @type {string} */ sheet,
  /** @type {string} */ ref,
  /** @type {string} */ v,
  style = "",
) {
  if (v.length > MAX_TEXT)
    throw new Error(
      `Export: ${sheet}!${ref} holds ${v.length} characters; a cell holds ${MAX_TEXT}. Export as CSV instead.`,
    );
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${cellText(v)}</t></is></c>`;
}

/** What a worksheet's XML starts with up to its rows, the header row included when asked. */
export function sheetHead(
  /** @type {{ name: string, columns: string[] }} */ sheet,
  /** @type {{ header: boolean }} */ o,
) {
  const count = sheet.columns.length;
  if (count > MAX_COLUMNS)
    throw new Error(`Export: ${sheet.name} has ${count} columns; a sheet holds ${MAX_COLUMNS}.`);
  const frozen = o.header
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : "";
  const header = o.header
    ? `<row r="1">${sheet.columns.map((c, i) => textCell(sheet.name, `${columnName(i)}1`, c, ' s="4"')).join("")}</row>`
    : "";
  return `${HEAD}<worksheet xmlns="${MAIN}">${frozen}<sheetData>${header}`;
}

/** What a worksheet's XML ends with. */
export const SHEET_FOOT = "</sheetData></worksheet>";

/** One worksheet's XML. */
function worksheet(/** @type {Sheet} */ sheet, /** @type {{ header: boolean, null: string }} */ o) {
  const total = sheet.rows.length + (o.header ? 1 : 0);
  const head = sheetHead(sheet, o);
  if (total > MAX_ROWS)
    throw new Error(`Export: ${sheet.name} has ${total} rows; a sheet holds ${MAX_ROWS}.`);
  const count = sheet.columns.length;
  const kinds = kindsOf(sheet.rows, count, sheet.oids ?? [], sheet.types ?? []);
  return `${head}${rowsXml(sheet, sheet.rows, o.header ? 2 : 1, kinds, o)}${SHEET_FOOT}`;
}

const STYLES = `${HEAD}<styleSheet xmlns="${MAIN}"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd hh:mm:ss.000"/></numFmts><fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * The workbook's bytes.
 * @param {Sheet[]} sheets
 * @param {{ header: boolean, null: string }} options
 * @param {{ deflate?: boolean }} [packing]
 */
export async function xlsxOf(sheets, options, packing = {}) {
  if (sheets.length === 0) throw new Error("Export: no result to put in a sheet.");
  const names = sheetNames(sheets.map((s) => s.name));
  const encoder = new TextEncoder();
  const part = (/** @type {string} */ name, /** @type {string} */ xml) => ({
    name,
    data: encoder.encode(xml),
  });
  return zip(
    [
      ...packageParts(names).map(({ name, xml }) => part(name, xml)),
      ...sheets.map((sheet, i) =>
        part(
          `xl/worksheets/sheet${i + 1}.xml`,
          worksheet({ ...sheet, name: names[i] ?? "" }, options),
        ),
      ),
    ],
    packing,
  );
}

/** The package's parts but the sheets: content types, relationships, the workbook and its styles. */
export function packageParts(/** @type {string[]} */ names) {
  const n = names.length;
  const types = names
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${TYPE}.worksheet+xml"/>`,
    )
    .join("");
  return [
    {
      name: "[Content_Types].xml",
      xml: `${HEAD}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${TYPE}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${TYPE}.styles+xml"/>${types}</Types>`,
    },
    {
      name: "_rels/.rels",
      xml: `${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      xml: `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml: `${HEAD}<Relationships xmlns="${PKG}/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", xml: STYLES },
  ];
}
