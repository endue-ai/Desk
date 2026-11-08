// RAR 5 headers, as RARLAB's RAR 5.0 technote describes them: the main header, file headers with
// their extra records (encryption, hashes, times, links) and the end of the archive. Lists the
// entries and keeps, per file, where its data is and how it was packed.
import { DAMAGED_HEADER, Fields, fileTime, u32, unixDate, utf8 } from "../bytes.js";
import { crc32 } from "../crc32.js";
import { cleanPath, ENCRYPTED, METHODS, SPLIT } from "../entries.js";
import { TRUNCATED } from "../input.js";

/** @typedef {import("../input.js").Source} Source */
/** @typedef {import("../entries.js").Entry} Entry */
/**
 * @typedef {{
 *   start: number, packed: number, size: number, known: boolean, crc?: number, blake: boolean,
 *   method: number, solid: boolean, version: number, dictionary: number, copyOf?: string,
 * }} Data
 * `version` is the algorithm (0, or 1 for RAR 7's larger dictionaries); `copyOf` names the entry
 * whose data a hard link or file copy repeats.
 */

export const BAD_HEADER_CRC = "A RAR header is damaged: its CRC does not match.";
const NEWER = "Packed with a RAR compression version the desk does not know: not extracted.";
const SEVEN =
  "Packed with RAR 7's method for dictionaries over 4 GB, which is not supported: not extracted.";
const MAPPED = /[-]/g;

/** The name as stored: UTF-8, with high bytes RAR mapped to U+E080-U+E0FF turned back. @param {Uint8Array} b */
function nameOf(b) {
  const name = utf8(b);
  if (!name.includes("￾")) return name;
  return name
    .replace(/￾/g, "")
    .replace(MAPPED, (c) => String.fromCharCode(c.charCodeAt(0) - 0xe000));
}

/** Reads one header at `pos`: its fields and where its data area is. @param {Source} source @param {number} pos */
async function header(source, pos) {
  if (pos + 7 > source.size) throw new Error(TRUNCATED);
  const head = await source.read(pos, Math.min(4096, source.size - pos));
  const lead = new Fields(head, 4);
  const size = lead.vint();
  if (lead.pos - 4 > 3 || size < 2) throw new Error(DAMAGED_HEADER);
  const total = lead.pos + size;
  if (pos + total > source.size) throw new Error(TRUNCATED);
  const block = total > head.length ? await source.read(pos, total) : head;
  if (crc32(block.subarray(4, total)) !== u32(block, 0)) throw new Error(BAD_HEADER_CRC);
  const f = new Fields(block, lead.pos, total);
  const type = f.vint();
  const flags = f.vint();
  const extra = flags & 1 ? f.vint() : 0;
  const data = flags & 2 ? f.vint() : 0;
  if (extra > total - f.pos) throw new Error(DAMAGED_HEADER);
  return { block, f, type, flags, extraStart: total - extra, total, data };
}

/** The extra records of a file header. @param {Fields} f @param {Entry} entry @param {Data} data */
function extras(f, entry, data) {
  while (f.pos < f.end) {
    const size = f.vint();
    const end = f.pos + size;
    if (end > f.end) throw new Error(DAMAGED_HEADER);
    const r = new Fields(f.bytes, f.pos, end);
    const type = r.vint();
    if (type === 1) {
      entry.encrypted = true;
      entry.refusal = ENCRYPTED;
    } else if (type === 2) {
      if (r.vint() === 0) data.blake = true;
    } else if (type === 3) {
      const flags = r.vint();
      const unix = (flags & 1) !== 0;
      /** @type {number[]} */
      const times = [];
      for (const bit of [2, 4, 8])
        if (flags & bit) times.push(unix ? r.u32() * 1000 : fileTime(r.u32(), r.u32()).getTime());
      if (flags & 2 && times[0] !== undefined) {
        const nanos = unix && flags & 0x10 ? r.u32() : 0;
        entry.date = new Date(times[0] + Math.floor(nanos / 1e6));
      }
    } else if (type === 5) {
      const kind = r.vint();
      r.vint();
      const target = nameOf(r.take(r.vint()));
      if (kind <= 3) {
        entry.kind = "link";
        entry.link = target;
      } else if (kind <= 5) data.copyOf = cleanPath(target);
    }
    f.pos = end;
  }
}

/** @param {number} info the compression information vint */
function packing(info) {
  const version = info & 0x3f;
  const method = (info >> 7) & 7;
  const bits = Math.floor(info / 0x400) & 0x1f;
  let dictionary = 0x20000 * 2 ** bits;
  if (version === 1)
    dictionary += Math.floor((dictionary / 32) * (Math.floor(info / 0x8000) & 0x1f));
  const algorithm = version === 1 && info & 0x100000 ? 0 : version;
  return { version: algorithm, method, dictionary, solid: (info & 0x40) !== 0 };
}

/**
 * Lists a RAR 5 archive whose signature is at `offset`.
 * @param {Source} source @param {number} offset
 */
export async function list5(source, offset) {
  /** @type {{ entry: Entry, data?: Data }[]} */
  const listed = [];
  const info = {
    solid: false,
    volume: false,
    first: true,
    recovery: false,
    locked: false,
    ended: false,
  };
  let pos = offset + 8;
  try {
    while (pos < source.size) {
      const h = await header(source, pos);
      const f = h.f;
      if (h.type === 4) {
        info.locked = true;
        break;
      }
      if (h.type === 5) {
        info.ended = true;
        break;
      }
      if (h.type === 1) {
        const flags = f.vint();
        info.volume = (flags & 1) !== 0;
        info.first = !(flags & 2);
        info.solid = (flags & 4) !== 0;
        info.recovery = (flags & 8) !== 0;
      } else if (h.type === 2) listed.push(file(h, pos));
      pos += h.total + h.data;
      if (pos > source.size) {
        const last = listed.at(-1);
        if (last?.data && h.type === 2) last.entry.refusal ??= TRUNCATED;
        throw new Error(TRUNCATED);
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== TRUNCATED || listed.length === 0)
      throw error;
    return { listed, info, cut: true };
  }
  return { listed, info, cut: !info.ended && !info.locked };
}

/** A file header as an entry and its data. @param {Awaited<ReturnType<typeof header>>} h @param {number} pos */
function file(h, pos) {
  const f = h.f;
  const fileFlags = f.vint();
  const size = f.vint();
  const attributes = f.vint();
  const mtime = fileFlags & 2 ? f.u32() : 0;
  const crc = fileFlags & 4 ? f.u32() : undefined;
  const pack = packing(f.vint());
  const host = f.vint();
  const name = nameOf(f.take(f.vint()));
  const folder = (fileFlags & 1) !== 0;
  /** @type {Entry} */
  const entry = {
    path: cleanPath(name),
    kind: folder ? "folder" : "file",
    size: folder ? 0 : fileFlags & 8 ? -1 : size,
    packed: h.data,
  };
  if (!folder) entry.method = METHODS[pack.method] ?? `Method ${pack.method}`;
  if (mtime) entry.date = unixDate(mtime);
  if (host === 1 && (attributes & 0xf000) === 0xa000) entry.kind = "link";
  /** @type {Data} */
  const data = {
    start: pos + h.total,
    packed: h.data,
    size,
    known: !(fileFlags & 8),
    blake: false,
    ...pack,
  };
  if (crc !== undefined) data.crc = crc;
  extras(new Fields(h.block, h.extraStart, h.total), entry, data);
  if (folder) return { entry };
  if (!entry.refusal && h.flags & 0x18) entry.refusal = SPLIT;
  if (!entry.refusal && (pack.version > 1 || pack.method > 5)) entry.refusal = NEWER;
  if (!entry.refusal && pack.version === 1) entry.refusal = SEVEN;
  if (entry.kind === "link") {
    entry.size = 0;
    return { entry };
  }
  if (data.copyOf) entry.method = "Copy of another entry";
  return { entry, data };
}
