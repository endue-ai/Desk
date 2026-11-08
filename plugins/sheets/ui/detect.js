// What a file is: the format its name promises, and what its first bytes say it is. The plugin
// trusts the bytes first: a .xls that is really a web page still opens, a .xlsx that is really
// text opens as the details view.

/** The format each extension names, as the details view and the header say it. */
export const FORMATS = /** @type {Record<string, string>} */ ({
  xlsx: "Excel workbook",
  xlsm: "Excel macro-enabled workbook",
  xlsb: "Excel binary workbook",
  xls: "Excel 97-2003 workbook",
  xlt: "Excel 97-2003 template",
  xltx: "Excel template",
  xltm: "Excel macro-enabled template",
  ods: "OpenDocument spreadsheet",
  ots: "OpenDocument spreadsheet template",
  fods: "Flat OpenDocument spreadsheet",
  numbers: "Numbers spreadsheet",
  csv: "Comma-separated values",
  tsv: "Tab-separated values",
  dif: "Data Interchange Format file",
  slk: "SYLK file",
  sylk: "SYLK file",
  wk1: "Lotus 1-2-3 worksheet",
  wk3: "Lotus 1-2-3 worksheet",
  wk4: "Lotus 1-2-3 worksheet",
  wks: "Lotus 1-2-3 or Works worksheet",
  123: "Lotus 1-2-3 worksheet",
  qpw: "Quattro Pro notebook",
  gsheet: "Google Sheets shortcut",
});

/** Extensions whose files are always binary containers: text under one of these names is damaged. */
export const BINARY = new Set(
  "xlsx xlsm xlsb xltx xltm ods ots numbers wk1 wk3 wk4 wks 123 qpw".split(" "),
);

/** The lower-case extension of a file name, without the dot. */
export const extensionOf = (/** @type {string} */ name) => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export const formatOf = (/** @type {string} */ name) => FORMATS[extensionOf(name)] ?? "Spreadsheet";

/** "an Excel workbook", "a SYLK file", "a spreadsheet". */
export const withArticle = (/** @type {string} */ format) =>
  `${/^[AEIOU]/u.test(format) ? "an" : "a"} ${format === "Spreadsheet" ? "spreadsheet" : format}`;

const startsWith = (/** @type {Uint8Array} */ bytes, /** @type {number[]} */ magic, at = 0) =>
  magic.every((byte, i) => bytes[at + i] === byte);

/**
 * What the first bytes say the file is.
 * @param {Uint8Array} bytes
 */
export function detect(bytes) {
  if (bytes.length === 0) return "Empty";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]))
    return "ZIP archive";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return "OLE compound file";
  if (startsWith(bytes, [0, 0]) && (bytes[2] === 2 || bytes[2] === 0x1a) && bytes[3] === 0)
    return "Lotus worksheet";
  if (startsWith(bytes, [0x51, 0x50, 0x57], 4)) return "Quattro Pro notebook";
  if (bytes[0] === 0x09 && [0, 2, 4].includes(bytes[1] ?? -1)) return "Excel 2-4 worksheet";
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return "UTF-16 text";
  const first = bytes.subarray(0, 1024);
  // Text has no control characters but tab, new lines, form feed and escape.
  if (
    first.some(
      (b) => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0c && b !== 0x0d && b !== 0x1b,
    )
  )
    return "Binary data";
  const head = new TextDecoder("latin1").decode(first);
  const lead = head.replace(/^(\xef\xbb\xbf)?\s*/u, "");
  if (/^<!doctype html|^<html|^<table/iu.test(lead)) return "HTML";
  if (lead.startsWith("<")) return "XML";
  if (lead.startsWith("{")) return "JSON";
  if (lead.startsWith("TABLE")) return "DIF";
  if (lead.startsWith("ID;")) return "SYLK";
  return "Text";
}
