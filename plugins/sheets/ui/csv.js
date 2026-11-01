// CSV and TSV: the encoding (a byte order mark, then UTF-8, then EUC-KR, or the setting), the
// delimiter (comma, semicolon, tab or pipe), and the fields as RFC 4180 writes them. The text each
// field shows is the text in the file; numbers in it are values too, so a range sums.
import { createSheet } from "./model.js";

/** The choices of the endue.sheets.csv-encoding setting, and what the details line calls each. */
export const ENCODINGS = /** @type {const} */ ({
  auto: "",
  "utf-8": "UTF-8",
  "euc-kr": "EUC-KR",
  shift_jis: "Shift_JIS",
  "windows-1252": "Windows-1252",
});

const DELIMITERS = /** @type {const} */ ([",", "\t", ";", "|"]);
const DELIMITER_NAMES = { ",": "comma", "\t": "tab", ";": "semicolon", "|": "pipe" };

/**
 * The text of a CSV file and the encoding it was read in.
 * @param {Uint8Array} bytes
 * @param {string} [choice] the setting: auto, or one of ENCODINGS
 */
export function decode(bytes, choice = "auto") {
  const named = /** @type {Record<string, string>} */ (ENCODINGS)[choice];
  if (choice !== "auto" && named) {
    return { text: new TextDecoder(choice).decode(bytes), encoding: named };
  }
  const [a, b, c] = bytes;
  if (a === 0xff && b === 0xfe)
    return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "UTF-16LE" };
  if (a === 0xfe && b === 0xff)
    return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "UTF-16BE" };
  if (a === 0xef && b === 0xbb && c === 0xbf)
    return { text: new TextDecoder("utf-8").decode(bytes), encoding: "UTF-8" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    // Not UTF-8: in Korea, Excel and most Windows programs write CSV in code page 949.
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "EUC-KR" };
  }
}

/**
 * How many times each candidate appears outside quotes on each of the first records.
 * @param {string} text
 * @param {number} [records]
 */
function counts(text, records = 50) {
  /** @type {number[][]} */
  const lines = [];
  let line = DELIMITERS.map(() => 0);
  let quoted = false;
  const end = Math.min(text.length, 65_536);
  for (let i = 0; i < end && lines.length < records; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(line);
      line = DELIMITERS.map(() => 0);
    } else if (!quoted) {
      const at = DELIMITERS.indexOf(/** @type {any} */ (ch));
      if (at >= 0) line[at] = (line[at] ?? 0) + 1;
    }
  }
  if (line.some((n) => n > 0)) lines.push(line);
  return lines;
}

/**
 * The delimiter that splits the most records into the same number of fields; a comma when none
 * does.
 * @param {string} text
 */
export function delimiterOf(text) {
  const lines = counts(text);
  let best = 0;
  let bestScore = 0;
  for (let d = 0; d < DELIMITERS.length; d++) {
    /** @type {Map<number, number>} */
    const seen = new Map();
    for (const line of lines) {
      const n = line[d] ?? 0;
      if (n > 0) seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    const score = Math.max(0, ...seen.values());
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return DELIMITERS[best] ?? ",";
}

/**
 * The records of a CSV text, each an array of fields. Quotes hold delimiters and new lines, and a
 * doubled quote is one quote. A final new line ends the last record; it does not start another.
 * @param {string} text
 * @param {string} delimiter
 * @returns {string[][]}
 */
export function parseCsv(text, delimiter) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"' && field === "") {
      // A quoted field: up to the quote that is not doubled.
      let j = i + 1;
      let value = "";
      for (;;) {
        const close = text.indexOf('"', j);
        if (close < 0) {
          value += text.slice(j);
          j = n;
          break;
        }
        value += text.slice(j, close);
        if (text[close + 1] === '"') {
          value += '"';
          j = close + 2;
        } else {
          j = close + 1;
          break;
        }
      }
      field = value;
      i = j;
      // Anything between the closing quote and the delimiter belongs to the field, as Excel reads it.
      while (i < n && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r")
        field += text[i++];
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      const next = nextStop(text, i, delimiter);
      field += text.slice(i, next);
      i = next;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The index of the next delimiter or line end after i. */
function nextStop(/** @type {string} */ text, /** @type {number} */ i, /** @type {string} */ d) {
  let j = i;
  while (j < text.length) {
    const ch = text[j];
    if (ch === d || ch === "\n" || ch === "\r") break;
    j++;
  }
  return j;
}

const PLAIN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;
const GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u;
const CURRENCY = /^([+-]?)[$€£¥₩]\s?(.+)$/u;

/** The number a field means, as a spreadsheet reads it, or undefined for text. */
export function numberOf(/** @type {string} */ raw) {
  const text = raw.trim();
  if (text === "") return undefined;
  if (PLAIN.test(text)) return Number(text);
  if (GROUPED.test(text)) return Number(text.replaceAll(",", ""));
  if (text.endsWith("%")) {
    const n = numberOf(text.slice(0, -1));
    return n === undefined ? undefined : Number((n / 100).toPrecision(15));
  }
  const money = CURRENCY.exec(text);
  if (money?.[2]) {
    const n = numberOf(money[2]);
    return n === undefined ? undefined : money[1] === "-" ? -n : n;
  }
  return undefined;
}

/**
 * Column widths for a format that has none: the longest text in the first rows, from Excel's
 * default width (64 pixels) up to 400. Wide characters (CJK) count twice.
 * @param {string[][]} rows
 */
export function widthsOf(rows) {
  /** @type {number[]} */
  const widths = [];
  for (const row of rows.slice(0, 2000)) {
    row.forEach((text, c) => {
      let units = 0;
      for (const ch of text.slice(0, 80))
        units += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/u.test(ch)
          ? 2
          : 1;
      const px = Math.min(400, Math.max(64, Math.round(units * 7 + 12)));
      if (px > (widths[c] ?? 0)) widths[c] = px;
    });
  }
  return widths;
}

/**
 * One sheet from a CSV or TSV file. Cells are made when the grid asks for them.
 * @param {Uint8Array} bytes
 * @param {{ name: string, encoding?: string }} file
 */
export function readCsv(bytes, { name, encoding = "auto" }) {
  const decoded = decode(bytes, encoding);
  const delimiter = delimiterOf(decoded.text);
  const rows = parseCsv(decoded.text, delimiter);
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const sheet = createSheet({
    widths: widthsOf(rows),
    name: name.replace(/\.[^.]*$/u, "") || name,
    rows: rows.length,
    cols,
    releaseRow: (r) => {
      delete rows[r];
    },
    cellAt: (r, c) => {
      const text = rows[r]?.[c];
      if (text === undefined || text === "") return undefined;
      const value = numberOf(text);
      return value === undefined ? { t: "s", v: text, w: text } : { t: "n", v: value, w: text };
    },
  });
  const named = DELIMITER_NAMES[/** @type {keyof typeof DELIMITER_NAMES} */ (delimiter)];
  return { sheet, detail: `${decoded.encoding}, ${named}` };
}
