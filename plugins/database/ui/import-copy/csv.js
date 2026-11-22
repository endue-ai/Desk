// A CSV file read as it streams in (PG-60), with the person's delimiter, quote and escape (a quote
// doubled inside quotes when the escape is the quote, RFC 4180), fed text in pieces cut anywhere, a
// record across pieces included, and answering the records it has whole. An unquoted field equal to
// the NULL text is NULL (an empty one by default), a quoted one never is; trimming takes the spaces
// around every value. A blank line is no record. Pure.

/**
 * @typedef {(string | null)[]} Row
 * @typedef {{ delimiter: string, quote: string, escape: string, nullText: string, trim: boolean }} CsvOptions
 * @typedef {{ push(text: string): Row[], end(): Row[] }} RowReader
 */

/**
 * @param {CsvOptions} options
 * @returns {RowReader}
 */
export function createCsvReader({ delimiter, quote, escape: escapeChar, nullText, trim }) {
  const sep = delimiter || ",";
  const q = quote;
  const esc = escapeChar || q;
  /** @type {Row} */
  let row = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  let afterQuote = false;
  let escaping = false;
  let afterCR = false;
  /** @type {Row[]} */
  let out = [];

  const endField = () => {
    const text = trim ? field.trim() : field;
    row.push(!wasQuoted && text === nullText ? null : text);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    const blank = row.length === 0 && !wasQuoted && (trim ? field.trim() : field) === "";
    endField();
    if (!blank) out.push(row);
    row = [];
  };

  return {
    push(text) {
      out = [];
      let seg = 0;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (afterCR) {
          afterCR = false;
          if (ch === "\n") {
            seg = i + 1;
            continue;
          }
        }
        if (quoted) {
          if (escaping) {
            escaping = false;
            field += ch === q || ch === esc ? ch : `${esc}${ch}`;
            seg = i + 1;
          } else if (afterQuote) {
            afterQuote = false;
            if (ch === q) {
              field += q;
              seg = i + 1;
            } else {
              // The quote closed the field: this character is read outside it.
              quoted = false;
              seg = i;
              i--;
            }
          } else if (ch === esc && esc !== q) {
            field += text.slice(seg, i);
            escaping = true;
            seg = i + 1;
          } else if (ch === q) {
            field += text.slice(seg, i);
            if (esc === q) afterQuote = true;
            else quoted = false;
            seg = i + 1;
          }
          continue;
        }
        if (ch === q && q !== "" && !wasQuoted) {
          const before = field + text.slice(seg, i);
          if (before === "" || (trim && before.trim() === "")) {
            field = "";
            quoted = true;
            wasQuoted = true;
            seg = i + 1;
          }
        } else if (ch === sep) {
          field += text.slice(seg, i);
          endField();
          seg = i + 1;
        } else if (ch === "\n" || ch === "\r") {
          field += text.slice(seg, i);
          endRow();
          if (ch === "\r") afterCR = true;
          seg = i + 1;
        }
      }
      field += text.slice(seg);
      return out;
    },
    end() {
      out = [];
      if (afterQuote) {
        afterQuote = false;
        quoted = false;
      }
      if (quoted) throw new Error("The file ends inside a quoted field.");
      if (field !== "" || wasQuoted || row.length > 0) endRow();
      return out;
    },
  };
}
