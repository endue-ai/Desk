// An .xlsx written as the rows come (PG-64): the package's small parts whole, then the one sheet
// streamed through zip-stream.js, its cells typed as xlsx.js types them (each column's kind from its
// PostgreSQL type). Past the format's 1,048,576 rows it stops with a sentence. No DOM.

import { kindsOf } from "./cells.js";
import { MAX_ROWS, packageParts, rowsXml, SHEET_FOOT, sheetHead, sheetNames } from "./xlsx.js";
import { zipStream } from "./zip-stream.js";

/**
 * @typedef {import("./stream.js").Meta} Meta
 * @typedef {import("./stream.js").Row} Row
 * @typedef {{ head(): Promise<Uint8Array[]>, rows(rows: Row[]): Promise<Uint8Array[]>, end(): Promise<Uint8Array[]> }} BytesWriter
 */

/**
 * @param {Meta} meta
 * @param {{ header: boolean, null: string }} o
 * @param {string} name The sheet's name.
 * @returns {BytesWriter}
 */
export function xlsxWriter(meta, o, name) {
  const encoder = new TextEncoder();
  const [sheetName = "Sheet 1"] = sheetNames([name]);
  const sheet = { name: sheetName, columns: meta.columns };
  const archive = zipStream();
  /** @type {ReturnType<ReturnType<typeof zipStream>["open"]> | undefined} */
  let open;
  /** @type {import("./cells.js").Kind[] | undefined} */
  let kinds;
  let next = o.header ? 2 : 1;
  return {
    async head() {
      const parts = packageParts([sheetName]).flatMap(({ name: path, xml }) =>
        archive.file(path, encoder.encode(xml)),
      );
      const head = sheetHead(sheet, o);
      open = archive.open("xl/worksheets/sheet1.xml");
      return [...parts, ...(await open.push(encoder.encode(head)))];
    },
    async rows(rows) {
      if (!open || !rows.length) return [];
      if (next - 1 + rows.length > MAX_ROWS)
        throw new Error(
          `Export: ${sheetName} has more than ${MAX_ROWS.toLocaleString("en-US")} rows, as many as a sheet holds. Export as CSV instead.`,
        );
      kinds ??= kindsOf(rows, meta.columns.length, meta.oids, meta.types);
      const xml = rowsXml(sheet, rows, next, kinds, o);
      next += rows.length;
      return open.push(encoder.encode(xml));
    },
    async end() {
      if (!open) return [];
      const tail = [...(await open.push(encoder.encode(SHEET_FOOT))), ...(await open.close())];
      return [...tail, ...archive.end()];
    },
  };
}
