// RAR 4 headers (RAR 1.5 to 4.x, the format RARLAB's RAR 4 technote describes): the archive
// header, file headers with sizes, names in OEM or packed Unicode form, DOS times and extended
// times, and the end of the archive. Lists the entries and keeps, per file, where its data is.
import { DAMAGED_HEADER, dosDate, plainName, u16, u32, unicodeName } from "../bytes.js";
import { crc32 } from "../crc32.js";
import { cleanPath, ENCRYPTED, METHODS, OLD_METHOD, SPLIT } from "../entries.js";
import { TRUNCATED } from "../input.js";
import { BAD_HEADER_CRC } from "../rar5/headers.js";

/** @typedef {import("../input.js").Source} Source */
/** @typedef {import("../entries.js").Entry} Entry */
/** @typedef {import("../decode.js").Data & { version: number, host: number }} Data */

const NEWER = "Packed with a RAR version the desk does not know: not extracted.";
const UNIX = 3;

/** The modification time with the extended time field's precision, if there is one. @param {Uint8Array} b @param {number} at @param {number} end @param {Date | undefined} date */
function extendedTime(b, at, end, date) {
  if (!date || at + 2 > end) return date;
  const flags = u16(b, at);
  const mode = flags >> 12;
  if (!(mode & 8)) return date;
  let fraction = 0;
  const count = mode & 3;
  for (let i = 0; i < count; i++) fraction |= (b[at + 2 + i] ?? 0) << (8 * (3 - count + i));
  return new Date(date.getTime() + (mode & 4 ? 1000 : 0) + Math.floor(fraction / 10000));
}

/** One file header as an entry and its data. @param {Uint8Array} b @param {number} pos @param {number} flags @param {number} size */
function file(b, pos, flags, size) {
  const high = (flags & 0x100) !== 0;
  if (size < (high ? 40 : 32)) throw new Error(DAMAGED_HEADER);
  const packed = u32(b, 7) + (high ? u32(b, 32) * 0x100000000 : 0);
  const unpacked = u32(b, 11) + (high ? u32(b, 36) * 0x100000000 : 0);
  const host = b[15] ?? 0;
  const version = b[24] ?? 0;
  const method = (b[25] ?? 0x30) - 0x30;
  const nameAt = high ? 40 : 32;
  const nameSize = u16(b, 26);
  if (nameAt + nameSize > size) throw new Error(DAMAGED_HEADER);
  const raw = b.subarray(nameAt, nameAt + nameSize);
  const name = flags & 0x200 ? unicodeName(raw, host) : plainName(raw, host);
  const attributes = u32(b, 28);
  const folder = (flags & 0xe0) === 0xe0;
  /** @type {Entry} */
  const entry = {
    path: cleanPath(name),
    kind: folder ? "folder" : "file",
    size: folder ? 0 : unpacked,
    packed,
  };
  const date = extendedTime(
    b,
    nameAt + nameSize + (flags & 0x400 ? 8 : 0),
    size,
    dosDate(u32(b, 20)),
  );
  if (date && flags & 0x1000) entry.date = date;
  else if (date) entry.date = date;
  if (folder) return { entry };
  entry.method = METHODS[method] ?? `Method ${method}`;
  if (host === UNIX && (attributes & 0xf000) === 0xa000) entry.kind = "link";
  /** @type {Data} */
  const data = {
    start: pos + size,
    packed,
    size: unpacked,
    known: true,
    crc: u32(b, 16),
    method,
    solid: (flags & 0x10) !== 0,
    dictionary: 0x10000 << ((flags >> 5) & 7),
    version,
    host,
  };
  if (flags & 0x04) {
    entry.encrypted = true;
    entry.refusal = ENCRYPTED;
  } else if (flags & 0x03) entry.refusal = SPLIT;
  else if (method < 0 || method > 5) entry.refusal = NEWER;
  else if (method > 0 && version < 29) entry.refusal = OLD_METHOD;
  else if (method > 0 && version !== 29 && version !== 36) entry.refusal = NEWER;
  return { entry, data };
}

/**
 * Lists a RAR 4 archive whose signature is at `offset`.
 * @param {Source} source @param {number} offset
 */
export async function list4(source, offset) {
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
  let pos = offset + 7;
  try {
    while (pos < source.size) {
      if (pos + 7 > source.size) throw new Error(TRUNCATED);
      const head = await source.read(pos, Math.min(4096, source.size - pos));
      const type = head[2] ?? 0;
      const flags = u16(head, 3);
      const size = u16(head, 5);
      if (size < 7) throw new Error(DAMAGED_HEADER);
      if (pos + size > source.size) throw new Error(TRUNCATED);
      const b = size > head.length ? await source.read(pos, size) : head;
      let add = flags & 0x8000 && size >= 11 ? u32(b, 7) : 0;
      if (type === 0x73 || type === 0x74 || type === 0x7a) {
        if ((crc32(b.subarray(2, size)) & 0xffff) !== u16(b, 0)) throw new Error(BAD_HEADER_CRC);
      }
      if (type === 0x73) {
        info.volume = (flags & 1) !== 0;
        info.solid = (flags & 8) !== 0;
        info.recovery = (flags & 0x40) !== 0;
        info.first = (flags & 0x100) !== 0 || !info.volume;
        if (flags & 0x80) {
          info.locked = true;
          break;
        }
      } else if (type === 0x74) {
        const item = file(b, pos, flags, size);
        add = item.entry.packed ?? 0;
        if (item.entry.path) listed.push(item);
        if (pos + size + add > source.size) {
          item.entry.refusal ??= TRUNCATED;
          throw new Error(TRUNCATED);
        }
      } else if (type === 0x7b) {
        info.ended = true;
        break;
      }
      pos += size + add;
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== TRUNCATED || listed.length === 0)
      throw error;
    return { listed, info, cut: true };
  }
  await links(source, listed);
  return { listed, info, cut: false };
}

/** Unix symbolic links keep their target as the entry's data: read the stored ones. @param {Source} source @param {{ entry: Entry, data?: Data }[]} listed */
async function links(source, listed) {
  for (const item of listed) {
    const { entry, data } = item;
    if (entry.kind !== "link" || !data || entry.refusal) continue;
    if (data.method === 0 && data.packed < 4096) {
      const bytes = await source.read(data.start, data.packed);
      if (crc32(bytes) === data.crc) entry.link = plainName(bytes, data.host);
    }
    entry.size = 0;
    if (data.method === 0) delete item.data;
  }
}
