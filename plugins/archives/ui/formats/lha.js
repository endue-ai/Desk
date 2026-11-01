// LHA / LZH (header levels 0 to 3): names, sizes, dates and methods; -lh0- and -lz4- entries,
// which are stored, are read. LHA's compression is not decoded.
import { dosDate, u16, u32, unixDate } from "../bytes.js";
import { cleanPath } from "./archive.js";
import { listedArchive, oldName } from "./stored.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./stored.js").Placed} Placed */

const NO_LHA = "LHA decompression is not available.";
const STORED = new Set(["-lh0-", "-lz4-", "-pm0-"]);

/** A name from bytes where 0xFF or "\" separates folders. @param {Uint8Array} b */
const pathOf = (b) => oldName(Uint8Array.from(b, (c) => (c === 0xff ? 0x2f : c)));

/**
 * The extension headers from `at` while each one names the next: type, data, next size.
 * @param {Uint8Array} b @param {number} at @param {number} size the first one's size @param {number} width 2 or 4
 */
function extensions(b, at, size, width) {
  /** @type {{ name?: string, dir?: string, time?: number }} */
  const out = {};
  while (size > 0 && at + size <= b.length) {
    const type = b[at] ?? 0;
    const data = b.subarray(at + 1, at + size - width);
    if (type === 0x01) out.name = pathOf(data);
    else if (type === 0x02) out.dir = pathOf(data);
    else if (type === 0x54 && data.length >= 4) out.time = u32(data, 0);
    at += size;
    size = width === 4 ? u32(b, at - 4) : u16(b, at - 2);
  }
  return { ...out, end: at };
}

/** @param {Source} source @param {string} _name */
export async function openLha(source, _name) {
  /** @type {Placed[]} */
  const listed = [];
  let offset = 0;
  while (offset + 22 <= source.size) {
    const peek = await source.read(offset, Math.min(4096, source.size - offset));
    if ((peek[0] ?? 0) === 0) break;
    const level = peek[20] ?? 0;
    const method = String.fromCharCode(...peek.subarray(2, 7));
    if (!/^-(lh|lz|pm)[0-9a-z]-$/.test(method))
      throw new Error(`The LHA header at byte ${offset} is damaged.`);
    let packed = u32(peek, 7);
    const original = u32(peek, 11);
    let total;
    let name = "";
    let dir = "";
    let date;
    if (level === 0 || level === 1) {
      total = (peek[0] ?? 0) + 2;
      const length = peek[21] ?? 0;
      name = pathOf(peek.subarray(22, 22 + length));
      const stamp = u32(peek, 15);
      date = dosDate(stamp >>> 16, stamp & 0xffff);
      if (level === 1) {
        // The extensions follow the base header and count in the packed size.
        const all = await source.read(offset, Math.min(source.size - offset, total + 65536));
        const ext = extensions(all, total, u16(all, total - 2), 2);
        packed -= ext.end - total;
        total = ext.end;
        name = ext.name ?? name;
        dir = ext.dir ?? "";
        if (ext.time) date = unixDate(ext.time);
      }
    } else if (level === 2 || level === 3) {
      const width = level === 2 ? 2 : 4;
      total = level === 2 ? u16(peek, 0) : u32(peek, 24);
      const b = total > peek.length ? await source.read(offset, total) : peek;
      const ext = extensions(
        b,
        level === 2 ? 26 : 32,
        level === 2 ? u16(b, 24) : u32(b, 28),
        width,
      );
      name = ext.name ?? "";
      dir = ext.dir ?? "";
      date = unixDate(u32(b, 15));
    } else throw new Error(`The LHA header at byte ${offset} has an unknown level ${level}.`);
    const folder = method === "-lhd-";
    const path = cleanPath(dir ? `${dir}/${name}` : name);
    /** @type {Placed} */
    const entry = {
      path,
      kind: folder ? "folder" : "file",
      size: folder ? 0 : original,
      packed,
      method: folder ? "" : method,
    };
    if (date) entry.date = date;
    if (!folder && !STORED.has(method)) entry.refusal = NO_LHA;
    else if (!folder) entry.start = offset + total;
    if (path) listed.push(entry);
    offset += total + packed;
  }
  return listedArchive(source, "LHA", listed, NO_LHA);
}
