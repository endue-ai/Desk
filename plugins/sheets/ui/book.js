// Opens a spreadsheet's bytes as a book: its visible sheets, the card of a Google Sheets shortcut,
// or the details view that says why it does not open. SheetJS parses the workbook; the plugin adds
// what SheetJS Community Edition leaves out (OOXML styles and frozen panes, ODS sizes and panes).
// Nothing here throws: every failure is a details view, and the parser's console stays quiet.
import { readCsv } from "./csv.js";
import { BINARY, detect, extensionOf, formatOf } from "./detect.js";
import { damaged, ENCRYPTED, failure, NO_WORKBOOK, OLD_NUMBERS, sayer } from "./errors.js";

export { ENCRYPTED, failure } from "./errors.js";

import { addressOf, createSheet } from "./model.js";
import { odsLayout } from "./ods.js";
import { odsParts } from "./ods-parts.js";
import { parseStyles, scanSheet } from "./styles.js";
import * as cptable from "./vendor/cpexcel.full.mjs";
import * as XLSX from "./vendor/xlsx.mjs";

XLSX.set_cptable(cptable);

/**
 * @typedef {import("./model.js").Sheet} Sheet
 * @typedef {import("./model.js").Cell} Cell
 * @typedef {import("./model.js").Frozen} Frozen
 * @typedef {import("./ods.js").Layout} Layout
 * @typedef {{ kind: "sheets", format: string, detail: string, sheets: Sheet[] }} Sheets
 * @typedef {{ kind: "details", format: string, detected: string, reason: string, cause?: string }} Details
 * @typedef {{ kind: "link", format: string, url: string }} Link
 * @typedef {Sheets | Details | Link} Book
 * @typedef {{ frozen?: Frozen, styleAt?: Sheet["style"], releaseRow?: (r: number) => void }} Extras
 * @typedef {(reason: string, cause?: string) => Details} Say
 */

const READ = {
  type: "array",
  dense: true,
  cellFormula: true,
  cellNF: true,
  cellStyles: true,
  sheetStubs: true,
  cellDates: false,
};
/** What a binary-only format may start with; the parser would read anything else as text. */
const CONTAINERS = new Set([
  "ZIP archive",
  "OLE compound file",
  "Lotus worksheet",
  "Quattro Pro notebook",
]);

const utf8 = (/** @type {ArrayLike<number> | undefined} */ data) =>
  data ? new TextDecoder().decode(data instanceof Uint8Array ? data : Uint8Array.from(data)) : "";

/** Run the parser with the console silenced: its warnings are not the person's business. */
function quietly(/** @type {() => Book} */ run) {
  const saved = [console.error, console.warn, console.log];
  const silent = () => {};
  console.error = silent;
  console.warn = silent;
  console.log = silent;
  try {
    return run();
  } finally {
    [console.error, console.warn, console.log] = saved;
  }
}

/** A Google Drive shortcut: JSON with the document's address, or only its id. */
function shortcut(/** @type {Uint8Array} */ bytes, /** @type {Say} */ say) {
  try {
    const json = JSON.parse(utf8(bytes));
    const id = typeof json?.doc_id === "string" && /^[\w-]+$/u.test(json.doc_id) ? json.doc_id : "";
    const url =
      typeof json?.url === "string" && /^https:\/\//u.test(json.url)
        ? json.url
        : id && `https://docs.google.com/spreadsheets/d/${id}/edit`;
    if (url) return { kind: "link", format: "Google Sheets shortcut", url };
  } catch {
    // Not JSON: the details view says so below.
  }
  return say("This shortcut holds no address of a Google Sheets document.");
}

/** Only the grid's declared cell fields; SheetJS rich text, HTML and fill objects stay private. */
const modelCell = (cell) => {
  if (!cell) return undefined;
  const value = { t: cell.t };
  for (const key of ["v", "w", "f", "z"]) if (cell[key] !== undefined) value[key] = cell[key];
  return value;
};

/**
 * One SheetJS worksheet as the grid's sheet.
 * @param {any} ws
 * @param {string} name
 * @param {Layout | undefined} layout
 * @param {Extras} extras
 */
function sheetOf(ws, name, layout, extras) {
  /** @type {(Cell[] | undefined)[] | undefined} */
  const data = ws?.["!data"];
  const range = ws?.["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { e: { r: -1, c: -1 } };
  let lastRow = data ? data.length - 1 : range.e.r;
  while (data && lastRow >= 0 && !data[lastRow]?.length) lastRow--;
  let lastCol = data ? -1 : range.e.c;
  for (const row of data ?? []) if (row && row.length - 1 > lastCol) lastCol = row.length - 1;
  /** @type {number[]} */
  const widths = [];
  /** @type {number[]} */
  const heights = [];
  const hiddenCols = new Set(layout?.hiddenCols);
  const hiddenRows = new Set(layout?.hiddenRows);
  (ws?.["!cols"] ?? []).forEach((/** @type {any} */ col, /** @type {number} */ c) => {
    if (!col) return;
    const px =
      col.width != null
        ? col.width * 7 + 5
        : (col.wpx ?? (col.wch != null ? col.wch * 7 + 5 : undefined));
    if (px != null) widths[c] = Math.round(px);
    if (col.hidden) hiddenCols.add(c);
  });
  (ws?.["!rows"] ?? []).forEach((/** @type {any} */ row, /** @type {number} */ r) => {
    if (!row) return;
    const px = row.hpt != null ? (row.hpt * 4) / 3 : row.hpx;
    if (px != null) heights[r] = Math.round(px);
    if (row.hidden) hiddenRows.add(r);
  });
  layout?.widths.forEach((px, c) => {
    widths[c] = px;
  });
  layout?.heights.forEach((px, r) => {
    heights[r] = px;
  });
  return createSheet({
    name,
    rows: lastRow + 1,
    cols: lastCol + 1,
    cellAt: (r, c) => modelCell(data ? data[r]?.[c] : ws?.[addressOf(r, c)]),
    merges: (ws?.["!merges"] ?? []).map((/** @type {any} */ m) => ({
      s: { r: m.s.r, c: m.s.c },
      e: { r: m.e.r, c: m.e.c },
    })),
    widths,
    heights,
    hiddenRows,
    hiddenCols,
    frozen: extras.frozen ?? layout?.frozen ?? { rows: 0, cols: 0 },
    styleAt: extras.styleAt,
    releaseRow: (r) => {
      if (data) data[r] = undefined;
      extras.releaseRow?.(r);
    },
    format: (cell) => {
      if (cell.t !== "n" || typeof cell.v !== "number") return undefined;
      try {
        return XLSX.SSF.format(typeof cell.z === "string" ? cell.z : "General", cell.v);
      } catch {
        return undefined;
      }
    },
  });
}

/**
 * What the plugin reads of an OOXML package itself: each sheet's cell formats and frozen panes.
 * @param {any} wb
 * @param {(path: string) => string} text
 * @returns {(index: number) => Extras}
 */
function ooxmlExtras(wb, text) {
  const dir = wb.Directory ?? {};
  const workbook = String(dir.workbooks?.[0] ?? "/xl/workbook.xml").replace(/^\//u, "");
  if (workbook.endsWith(".bin")) return () => ({});
  const styles = parseStyles(
    text(String(dir.style ?? "").replace(/^\//u, "")),
    text(String(dir.themes?.[0] ?? "").replace(/^\//u, "")),
  );
  const base = workbook.slice(0, workbook.lastIndexOf("/") + 1);
  const rels = text(`${base}_rels/${workbook.slice(base.length)}.rels`);
  /** @type {Map<string, string>} */
  const targets = new Map();
  for (const [tag] of rels.matchAll(/<(?:\w+:)?Relationship\s[^>]*>/gu)) {
    const id = /\sId="([^"]*)"/u.exec(tag)?.[1];
    const target = /\sTarget="([^"]*)"/u.exec(tag)?.[1];
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : base + target);
  }
  const styled = styles.some(Boolean);
  return (index) => {
    const target = targets.get(wb.Workbook?.Sheets?.[index]?.id ?? "");
    const part = target ? text(target) : "";
    if (!part) return {};
    const scan = scanSheet(part);
    /** @type {Extras} */
    const extras = scan.frozen ? { frozen: scan.frozen } : {};
    if (styled) {
      extras.releaseRow = scan.releaseRow;
      extras.styleAt = (r, c) => {
        const format = scan.format(r, c);
        return format === undefined ? undefined : styles[format];
      };
    }
    return extras;
  };
}

/**
 * The visible sheets of a SheetJS workbook.
 * @param {any} wb
 * @param {Say} say
 * @param {{ ods?: ReturnType<typeof odsLayout>, ooxml?: (index: number) => Extras, only?: string, emit?: (sheet: Sheet, total: number) => void }} extra
 * @returns {Book}
 */
function bookOf(wb, say, { ods, ooxml, only, emit }) {
  /** @type {string[]} */
  const names = wb.SheetNames ?? [];
  const isHidden = (/** @type {string} */ name, /** @type {number} */ i) =>
    Boolean(wb.Workbook?.Sheets?.[i]?.Hidden) || Boolean(ods?.hidden.has(name));
  const shown = names.filter((name, i) => !isHidden(name, i));
  // A workbook whose every sheet is hidden still shows them: Excel never saves one, others might.
  const visible = shown.length ? shown : names;
  if (!visible.length) return say("This workbook has no sheets.");
  const sheets = visible
    .filter((name) => !only || name === only)
    .map((name) => {
      const i = names.indexOf(name);
      const sheet = sheetOf(wb.Sheets[name], name, ods?.sheets.get(name), ooxml?.(i) ?? {});
      emit?.(sheet, visible.length);
      return sheet;
    });
  const left = names.length - visible.length;
  const detail = left ? `${left} hidden sheet${left === 1 ? "" : "s"} left out` : "";
  return { kind: "sheets", format: say("").format, detail, sheets };
}

/**
 * @param {Uint8Array} bytes
 * @param {Say} say
 * @param {(sheet: Sheet, total: number) => void} [emit]
 */
function fromZip(bytes, say, emit) {
  const zip = XLSX.CFB.read(bytes, { type: "buffer" });
  // CFB.find takes a path from the root; without the slash it matches any entry of that name.
  const entry = (/** @type {string} */ path) => XLSX.CFB.find(zip, `/${path.replace(/^\//u, "")}`);
  const text = (/** @type {string} */ path) => (path ? utf8(entry(path)?.content) : "");
  if (entry("META-INF/manifest.xml")) {
    if (text("META-INF/manifest.xml").includes("encryption-data")) return say(ENCRYPTED);
    const content = text("content.xml");
    const ods = odsLayout(content, text("settings.xml"));
    if (emit) {
      const part = entry("content.xml");
      const saved = part.content;
      const count = ods.sheets.size - ods.hidden.size || ods.sheets.size;
      let left = 0;
      try {
        for (const xml of odsParts(content)) {
          part.content = new TextEncoder().encode(xml);
          const wb = XLSX.parse_zip(zip, { ...READ });
          if (ods.hidden.size < ods.sheets.size && ods.hidden.has(wb.SheetNames[0])) {
            left++;
            continue;
          }
          const book = bookOf(wb, say, { ods });
          if (book.kind !== "sheets") return book;
          for (const sheet of book.sheets) emit(sheet, count);
        }
      } finally {
        part.content = saved;
      }
      return {
        kind: "sheets",
        format: say("").format,
        detail: left ? `${left} hidden sheet${left === 1 ? "" : "s"} left out` : "",
        sheets: [],
      };
    }
    const wb = XLSX.parse_zip(zip, { ...READ });
    return bookOf(wb, say, { ods });
  }
  if (entry("Index/Document.iwa") || entry("Index.zip"))
    return bookOf(XLSX.parse_zip(zip, { ...READ }), say, {});
  if (entry("index.xml") || entry("index.xml.gz")) return say(OLD_NUMBERS);
  if (!entry("[Content_Types].xml")) return say(NO_WORKBOOK);
  if (emit) {
    const header = XLSX.parse_zip(zip, { ...READ, bookSheets: true });
    let last;
    for (const name of header.SheetNames ?? []) {
      // Selective OOXML parsing keeps the next worksheet untouched until this one is sent.
      const wb = XLSX.parse_zip(zip, { ...READ, sheets: name });
      last = bookOf(wb, say, { ooxml: ooxmlExtras(wb, text), only: name, emit });
    }
    return last?.kind === "sheets" ? { ...last, sheets: [] } : say("This workbook has no sheets.");
  }
  const wb = XLSX.parse_zip(zip, { ...READ });
  return bookOf(wb, say, { ooxml: ooxmlExtras(wb, text) });
}

/**
 * Open a spreadsheet file.
 * @param {Uint8Array} bytes the whole file
 * @param {{ name: string, encoding?: string, onSheet?: (sheet: Sheet, total: number) => void }} file its name, and the csv-encoding setting
 * @returns {Book}
 */
export function openBook(bytes, { name, encoding = "auto", onSheet }) {
  const say = sayer(bytes, name);
  const ext = extensionOf(name);
  const detected = detect(bytes);
  if (detected === "Empty") return say("The file is empty.");
  if (ext === "gsheet") return shortcut(bytes, say);
  try {
    return quietly(() => {
      if (detected === "ZIP archive") return fromZip(bytes, say, onSheet);
      if (detected !== "OLE compound file") {
        if (ext === "csv" || ext === "tsv") {
          const { sheet, detail } = readCsv(bytes, { name, encoding });
          return { kind: "sheets", format: formatOf(name), detail, sheets: [sheet] };
        }
        if (
          (BINARY.has(ext) && !CONTAINERS.has(detected)) ||
          (ext === "fods" && detected !== "XML")
        )
          return say(damaged(name));
      }
      const wb = XLSX.read(bytes, { ...READ });
      return bookOf(wb, say, wb.bookType === "fods" ? { ods: odsLayout(utf8(bytes)) } : {});
    });
  } catch (error) {
    return failure(bytes, name, error);
  }
}
