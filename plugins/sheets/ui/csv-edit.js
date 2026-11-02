// Edits to one CSV or TSV file (ADR 0071): what the grid shows after them, and what a save writes.
// Only the file's own fields are edited, so its rows stay as ragged as they were. Each edited field
// is written as the file writes it (csv-syntax.js fieldBytes); a field set back to its text on disk
// is no longer an edit. A save becomes the file the next edits are measured against.
import { cellOfText } from "./csv.js";
import {
  fieldBytes,
  fieldIndex,
  fieldText,
  isQuoted,
  parseSyntax,
  serialize,
} from "./csv-syntax.js";

/**
 * @typedef {import("./csv-syntax.js").CsvSyntax} CsvSyntax
 * @typedef {import("./model.js").Sheet} Sheet
 * @typedef {ReturnType<typeof createCsvDoc>} CsvDoc
 */

/** @param {CsvSyntax} file the file as it was read */
export function createCsvDoc(file) {
  let syntax = file;
  /** The text of every cell edited since the file was read, by field: what the grid shows. */
  /** @type {Map<number, string>} */
  const texts = new Map();
  /** The bytes of each field that differs from the file on disk, by field: what a save writes. */
  /** @type {Map<number, Uint8Array>} */
  const pending = new Map();
  const field = (/** @type {number} */ r, /** @type {number} */ c) => fieldIndex(syntax, r, c);

  return {
    get syntax() {
      return syntax;
    },
    /** Whether a save would change the file on disk. */
    get modified() {
      return pending.size > 0;
    },
    /** Whether the file has a field at row r, column c. */
    editable: (/** @type {number} */ r, /** @type {number} */ c) => field(r, c) >= 0,
    /** The text a cell was edited to, or undefined when it was not. */
    text(/** @type {number} */ r, /** @type {number} */ c) {
      const f = field(r, c);
      return f < 0 ? undefined : texts.get(f);
    },
    /**
     * Set a cell's text: "changed", "same" when it already shows that text, or "outside" when the
     * file has no field there.
     * @param {number} r
     * @param {number} c
     * @param {string} text
     * @returns {"changed" | "same" | "outside"}
     */
    set(r, c, text) {
      const f = field(r, c);
      if (f < 0) return "outside";
      if (text === (texts.get(f) ?? fieldText(syntax, f))) return "same";
      texts.set(f, text);
      if (text === fieldText(syntax, f)) pending.delete(f);
      else pending.set(f, fieldBytes(text, isQuoted(syntax, f), syntax.delimiter));
      return "changed";
    },
    /**
     * The bytes to write; `commit()` once they are written makes them the file. Edits made in
     * between stay unsaved.
     */
    save() {
      const written = new Map(pending);
      const bytes = serialize(syntax, written);
      return {
        bytes,
        commit() {
          syntax = parseSyntax(bytes, String.fromCharCode(syntax.delimiter));
          for (const [f, raw] of written) if (pending.get(f) === raw) pending.delete(f);
        },
      };
    },
  };
}

/**
 * The grid's sheet with a document's edits over it. The formula bar shows each field's text as the
 * file writes it ("1,200.50", not 1200.5), which is what an edit starts from.
 * @param {Sheet} sheet
 * @param {CsvDoc} doc
 * @returns {Sheet}
 */
export function editableSheet(sheet, doc) {
  return {
    ...sheet,
    cell: (r, c) => {
      const text = doc.text(r, c);
      return text === undefined ? sheet.cell(r, c) : cellOfText(text);
    },
    filled: (r, c) => {
      const text = doc.text(r, c);
      return text === undefined ? sheet.filled(r, c) : text !== "";
    },
    text: (r, c) => doc.text(r, c) ?? sheet.text(r, c),
    input: (r, c) => doc.text(r, c) ?? sheet.cell(r, c)?.w ?? "",
  };
}
