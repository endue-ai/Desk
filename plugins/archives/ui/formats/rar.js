// RAR 4 and RAR 5: the headers listed (names, sizes, dates, methods); the data of stored entries
// read. Decompression is not available: RAR's algorithm is published only as the unrar source.
import { at, dosDate, text, u16, u32, unixDate, utf8 } from "../bytes.js";
import { crc32 } from "../codecs/checksums.js";
import { cleanPath, ENCRYPTED, withFolders } from "./archive.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {Entry & { start?: number, crc?: number }} RarEntry */

export const NO_RAR = "RAR decompression is not available.";
const LOCKED = "The RAR's headers are encrypted, so its names cannot be listed.";
const SPLIT = "This entry continues in another volume.";

/** @param {number} method 0 stored, 1-5 the -m levels */
const methodName = (method) => (method === 0 ? "Stored" : `Compressed (method ${method})`);

/** The archive's entries, with the stored ones readable. @param {Source} source @param {RarEntry[]} listed @param {string} format */
function archiveOf(
  source,
  listed,
  format,
  details = /** @type {import("./archive.js").Detail[]} */ ([]),
) {
  return /** @type {Archive} */ ({
    format,
    entries: withFolders(listed),
    details,
    refusal: NO_RAR,
    read: async (entry, limit = Number.POSITIVE_INFINITY) => {
      const e = /** @type {RarEntry} */ (entry);
      if (e.kind === "folder") return new Uint8Array(0);
      if (e.refusal) throw new Error(e.refusal);
      if (e.start === undefined) throw new Error(NO_RAR);
      const whole = limit >= e.size;
      const bytes = (await source.read(e.start, Math.min(e.size, limit))).slice();
      if (whole && e.crc !== undefined && crc32(bytes) !== e.crc)
        throw new Error(`The stored data of ${e.path} does not match its CRC.`);
      return bytes;
    },
  });
}

/** RAR 3's Unicode names: an ASCII name, a zero, then the encoded wide name. @param {Uint8Array} field */
function rar4Name(field) {
  const zero = field.indexOf(0);
  if (zero < 0) return text(field);
  const ascii = field.subarray(0, zero);
  const enc = field.subarray(zero + 1);
  /** @type {number[]} */
  const out = [];
  let pos = 0;
  const high = enc[pos++] ?? 0;
  let flags = 0;
  let bits = 0;
  while (pos < enc.length) {
    if (bits === 0) {
      flags = enc[pos++] ?? 0;
      bits = 8;
    }
    const kind = flags >> 6;
    if (kind === 0) out.push(enc[pos++] ?? 0);
    else if (kind === 1) out.push((enc[pos++] ?? 0) + (high << 8));
    else if (kind === 2) {
      out.push((enc[pos] ?? 0) + ((enc[pos + 1] ?? 0) << 8));
      pos += 2;
    } else {
      let length = enc[pos++] ?? 0;
      if (length & 0x80) {
        const correction = enc[pos++] ?? 0;
        for (length = (length & 0x7f) + 2; length > 0 && out.length < ascii.length; length--)
          out.push((((ascii[out.length] ?? 0) + correction) & 0xff) + (high << 8));
      } else
        for (length += 2; length > 0 && out.length < ascii.length; length--)
          out.push(ascii[out.length] ?? 0);
    }
    flags = (flags << 2) & 0xff;
    bits -= 2;
  }
  return String.fromCharCode(...out);
}

/** @param {Source} source */
async function openRar4(source) {
  /** @type {RarEntry[]} */
  const listed = [];
  let offset = 7;
  let solid = false;
  while (offset + 7 <= source.size) {
    const head = await source.read(offset, Math.min(4096, source.size - offset));
    const type = head[2] ?? 0;
    const flags = u16(head, 3);
    const size = u16(head, 5);
    if (size < 7) throw new Error(`The RAR block at byte ${offset} is damaged.`);
    const block = size > head.length ? await source.read(offset, size) : head;
    let add = flags & 0x8000 ? u32(block, 7) : 0;
    if (type === 0x73) {
      if (flags & 0x80) return { listed, locked: true, solid };
      solid = (flags & 0x08) !== 0;
    } else if (type === 0x74) {
      const high = flags & 0x100;
      const packed = u32(block, 7) + (high ? u32(block, 32) * 0x100000000 : 0);
      const unpacked = u32(block, 11) + (high ? u32(block, 36) * 0x100000000 : 0);
      add = packed;
      const nameAt = high ? 40 : 32;
      const raw = block.subarray(nameAt, nameAt + u16(block, 26));
      const name = flags & 0x200 ? rar4Name(raw) : text(raw);
      const method = (block[25] ?? 0x30) - 0x30;
      const folder = (flags & 0xe0) === 0xe0;
      const time = u32(block, 20);
      /** @type {RarEntry} */
      const entry = {
        path: cleanPath(name),
        kind: folder ? "folder" : "file",
        size: folder ? 0 : unpacked,
        packed,
        method: folder ? "" : methodName(method),
      };
      const date = dosDate(time >>> 16, time & 0xffff);
      if (date) entry.date = date;
      if (flags & 0x04) {
        entry.encrypted = true;
        entry.refusal = ENCRYPTED;
      } else if (flags & 0x03) entry.refusal = SPLIT;
      else if (method !== 0) entry.refusal = NO_RAR;
      else {
        entry.start = offset + size;
        entry.crc = u32(block, 16);
      }
      if (entry.path) listed.push(entry);
    } else if (type === 0x7b) break;
    offset += size + add;
  }
  return { listed, locked: false, solid };
}

/** A RAR 5 variable-length integer. */
class Vints {
  /** @param {Uint8Array} b @param {number} pos */
  constructor(b, pos) {
    this.b = b;
    this.pos = pos;
  }
  next() {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const c = this.b[this.pos++];
      if (c === undefined) throw new Error("The RAR header ends early.");
      value += (c & 0x7f) * scale;
      scale *= 128;
      if (!(c & 0x80)) return value;
    }
    throw new Error("The RAR header is damaged.");
  }
  u32() {
    this.pos += 4;
    return u32(this.b, this.pos - 4);
  }
}

/** The extra area of a RAR 5 file header: encryption, times, links. @param {Uint8Array} b @param {number} from @param {number} to @param {RarEntry} entry */
function rar5Extra(b, from, to, entry) {
  let pos = from;
  while (pos < to) {
    const v = new Vints(b, pos);
    const size = v.next();
    const end = v.pos + size;
    const type = v.next();
    if (type === 1) {
      entry.encrypted = true;
      entry.refusal = ENCRYPTED;
    } else if (type === 3) {
      const flags = v.next();
      if (flags & 2) {
        if (flags & 1) entry.date = unixDate(v.u32());
        else {
          const low = v.u32();
          const high = v.u32();
          const ms = (high * 0x100000000 + low) / 10000 - 11644473600000;
          entry.date = new Date(Math.round(ms));
        }
      }
    } else if (type === 5) {
      const kind = v.next();
      v.next();
      const length = v.next();
      entry.link = utf8(b.subarray(v.pos, v.pos + length));
      if (kind <= 3) entry.kind = "link";
    }
    pos = end;
  }
}

/** @param {Source} source */
async function openRar5(source) {
  /** @type {RarEntry[]} */
  const listed = [];
  let offset = 8;
  let solid = false;
  while (offset + 7 <= source.size) {
    const head = await source.read(offset, Math.min(4096, source.size - offset));
    const lead = new Vints(head, 4);
    const size = lead.next();
    const begin = lead.pos;
    const b = begin + size > head.length ? await source.read(offset, begin + size) : head;
    const v = new Vints(b, begin);
    const type = v.next();
    const flags = v.next();
    const extra = flags & 1 ? v.next() : 0;
    const data = flags & 2 ? v.next() : 0;
    const end = begin + size;
    if (type === 4) return { listed, locked: true, solid };
    if (type === 1) solid = (v.next() & 4) !== 0;
    if (type === 2) {
      const fileFlags = v.next();
      const unpacked = v.next();
      v.next(); // attributes
      const mtime = fileFlags & 2 ? v.u32() : 0;
      const crc = fileFlags & 4 ? v.u32() : undefined;
      const info = v.next();
      v.next(); // host OS
      const length = v.next();
      const name = utf8(b.subarray(v.pos, v.pos + length));
      const folder = (fileFlags & 1) !== 0;
      const method = (info >> 7) & 7;
      /** @type {RarEntry} */
      const entry = {
        path: cleanPath(name),
        kind: folder ? "folder" : "file",
        size: folder ? 0 : unpacked,
        packed: data,
        method: folder ? "" : methodName(method),
      };
      if (mtime) entry.date = unixDate(mtime);
      rar5Extra(b, end - extra, end, entry);
      if (!entry.refusal) {
        if (flags & 0x18) entry.refusal = SPLIT;
        else if (method !== 0 && !folder) entry.refusal = NO_RAR;
        else if (!folder && entry.kind === "file") {
          entry.start = offset + end;
          if (crc !== undefined) entry.crc = crc;
        }
      }
      if (entry.path) listed.push(entry);
    } else if (type === 5) break;
    offset += end + data;
  }
  return { listed, locked: false, solid };
}

/** @param {Source} source @param {string} _name */
export async function openRar(source, _name) {
  const sig = await source.read(0, 8);
  const five = at(sig, 0, "Rar!\x1a\x07\x01\x00");
  if (!five && !at(sig, 0, "Rar!\x1a\x07\x00")) throw new Error("This is not a RAR archive.");
  const format = five ? "RAR 5" : "RAR 4";
  const { listed, locked, solid } = five ? await openRar5(source) : await openRar4(source);
  const details = [{ label: "Solid", value: solid ? "Yes" : "No" }];
  if (locked) {
    const archive = archiveOf(source, [], format, details);
    archive.note = LOCKED;
    return archive;
  }
  return archiveOf(source, listed, format, details);
}
