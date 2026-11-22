// Reads an .xlsx back for the export tests (PG-61): the zip's central directory, each entry
// inflated with node's zlib (or stored) and its CRC-32 checked, and each sheet's cells as their
// type, style and value, through the platform's DOMParser (jsdom). A test reader only.
import { inflateRawSync } from "node:zlib";
import { crc32 } from "../ui/export/zip.js";

export type ReadCell = { t: "n" | "s" | "d"; v: string; style: number };
export type ReadSheet = { name: string; cells: Map<string, ReadCell>; frozen: boolean };

/** Every file of a zip by name, checked against its CRC-32. */
export function unzip(bytes: Uint8Array): Map<string, { data: Uint8Array; method: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("no end of central directory");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, { data: Uint8Array; method: number }>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad central record");
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + packed);
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    if (crc32(data) !== crc) throw new Error(`${name}: CRC-32 differs`);
    out.set(name, { data, method });
    at += 46 + nameLength;
  }
  return out;
}

const parse = (data: Uint8Array) =>
  new DOMParser().parseFromString(new TextDecoder().decode(data), "application/xml");

/** `_xHHHH_` back to its character, and `_x005F_` back to `_`. */
const unescapeText = (s: string) =>
  s.replace(/_x([0-9A-F]{4})_/gu, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

/** Each sheet of a workbook, in the workbook's order, with its cells by reference. */
export function readXlsx(bytes: Uint8Array): ReadSheet[] {
  const files = unzip(bytes);
  const file = (name: string) => {
    const got = files.get(name);
    if (!got) throw new Error(`no ${name}`);
    const doc = parse(got.data);
    if (doc.getElementsByTagName("parsererror").length) throw new Error(`${name} is not XML`);
    return doc;
  };
  file("[Content_Types].xml");
  file("_rels/.rels");
  file("xl/styles.xml");
  const rels = file("xl/_rels/workbook.xml.rels");
  const targets = new Map(
    [...rels.getElementsByTagName("Relationship")].map((r) => [
      r.getAttribute("Id"),
      r.getAttribute("Target"),
    ]),
  );
  return [...file("xl/workbook.xml").getElementsByTagName("sheet")].map((sheet) => {
    const target = targets.get(sheet.getAttribute("r:id"));
    const doc = file(`xl/${target}`);
    const cells = new Map<string, ReadCell>();
    for (const c of doc.getElementsByTagName("c")) {
      const style = Number(c.getAttribute("s") ?? 0);
      const inline = c.getAttribute("t") === "inlineStr";
      const v = inline
        ? unescapeText(c.getElementsByTagName("t")[0]?.textContent ?? "")
        : (c.getElementsByTagName("v")[0]?.textContent ?? "");
      cells.set(c.getAttribute("r") ?? "", { t: inline ? "s" : style ? "d" : "n", v, style });
    }
    return {
      name: sheet.getAttribute("name") ?? "",
      cells,
      frozen: doc.getElementsByTagName("pane").length > 0,
    };
  });
}

/** A date cell's serial as the ISO text it was written from. */
export const isoOf = (serial: string) =>
  new Date(Date.UTC(1899, 11, 30) + Math.round(Number(serial) * 86_400_000))
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
