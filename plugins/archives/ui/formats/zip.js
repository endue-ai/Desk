// ZIP and everything built on it (jar, apk, ipa, docx-like packages, crx, whl, nupkg, appx, ...):
// the end record and the central directory read from the end of the file in a few ranged reads,
// ZIP64, UTF-8, Unicode-path, CP949 and CP437 names, and each entry read only when asked for.

import { crc32 } from "@endue-ai/formats/codecs/checksums.js";
import { collect, decodeStream, pause } from "@endue-ai/formats/codecs/index.js";
import { inputFrom, named } from "@endue-ai/formats/codecs/input.js";
import { lzmaRaw } from "@endue-ai/formats/codecs/lzma/index.js";
import { at, cp437, dosDate, text, u16, u32, u64, unixDate, utf8 } from "../bytes.js";
import { cleanPath, ENCRYPTED, row, withFolders } from "./archive.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {Entry & { offset: number, method_: number, crc: number, flags: number }} ZipEntry */

const METHODS = /** @type {Record<number, [string, string?]>} */ ({
  0: ["Stored"],
  1: ["Shrink"],
  6: ["Implode"],
  8: ["Deflate", "deflate"],
  9: ["Deflate64"],
  12: ["bzip2", "bzip2"],
  14: ["LZMA"],
  20: ["Zstandard", "zstd"],
  93: ["Zstandard", "zstd"],
  95: ["xz", "xz"],
  98: ["PPMd"],
  99: ["AES"],
});

let korean = /** @type {TextDecoder | null | undefined} */ (undefined);
/** A name without the UTF-8 flag: UTF-8 when it is valid, CP949 when that reads as Hangul, else CP437. @param {Uint8Array} b */
function legacyName(b) {
  if (b.every((c) => c < 0x80)) return cp437(b);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {}
  try {
    korean ??= new TextDecoder("euc-kr", { fatal: true });
    const name = korean.decode(b);
    if (/[가-힣]/.test(name)) return name;
  } catch {}
  return cp437(b);
}

/** Where the ZIP starts after a CRX header (0 for a plain ZIP), and the header's name. @param {Source} source */
async function crxStart(source) {
  const head = await source.read(0, 16);
  if (!at(head, 0, "Cr24")) return { start: 0, header: "" };
  const version = u32(head, 4);
  if (version === 2) return { start: 16 + u32(head, 8) + u32(head, 12), header: "CRX 2" };
  if (version === 3) return { start: 12 + u32(head, 8), header: "CRX 3" };
  throw new Error(`CRX version ${version} is not read here.`);
}

/** The end of central directory record, ZIP64's when there is one. @param {Source} source */
async function endRecord(source) {
  for (const span of [4096, 65557]) {
    const length = Math.min(source.size, span);
    const tail = await source.read(source.size - length, length);
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] !== 0x50 || !at(tail, i, "PK\x05\x06")) continue;
      const pos = source.size - length + i;
      if (pos + 22 + u16(tail, i + 20) > source.size) continue;
      const end = {
        pos,
        disk: u16(tail, i + 4),
        count: u16(tail, i + 10),
        size: u32(tail, i + 12),
        offset: u32(tail, i + 16),
        comment: tail.subarray(i + 22, i + 22 + u16(tail, i + 20)),
      };
      const locator = i >= 20 ? tail.subarray(i - 20, i) : await source.read(pos - 20, 20);
      if (pos >= 20 && at(locator, 0, "PK\x06\x07")) {
        const at64 = u64(locator, 8);
        const rec = await source.read(at64, 56);
        if (!at(rec, 0, "PK\x06\x06")) throw new Error("The ZIP64 end record is missing.");
        return {
          ...end,
          pos: at64,
          disk: u32(rec, 16),
          count: u64(rec, 32),
          size: u64(rec, 40),
          offset: u64(rec, 48),
        };
      }
      return end;
    }
    if (length === source.size) break;
  }
  throw new Error("The ZIP's central directory was not found: the file is not a whole ZIP.");
}

/**
 * The extra fields this reader uses: ZIP64 sizes, Unix and NTFS times, the Unicode path, AES.
 * @param {Uint8Array} extra @param {{ size: number, packed: number, offset: number }} wide
 */
function extras(extra, wide) {
  /** @type {{ date?: Date, name?: string, aes?: number }} */
  const out = {};
  for (let i = 0; i + 4 <= extra.length; ) {
    const id = u16(extra, i);
    const n = u16(extra, i + 2);
    const d = extra.subarray(i + 4, i + 4 + n);
    if (id === 0x0001) {
      let o = 0;
      for (const key of /** @type {const} */ (["size", "packed", "offset"]))
        if (wide[key] === 0xffffffff && o + 8 <= d.length) {
          wide[key] = u64(d, o);
          o += 8;
        }
    } else if (id === 0x5455 && d.length >= 5 && (d[0] ?? 0) & 1) out.date = unixDate(u32(d, 1));
    else if (id === 0x000a && d.length >= 32 && u16(d, 4) === 1 && !out.date) {
      const ms = (u32(d, 12) * 0x100000000 + u32(d, 8)) / 10000 - 11644473600000;
      out.date = new Date(Math.round(ms));
    } else if (id === 0x7075 && d.length > 5 && d[0] === 1) out.name = utf8(d.subarray(5));
    else if (id === 0x9901 && d.length >= 7) out.aes = u16(d, 5);
    i += 4 + n;
  }
  return out;
}

/** @param {Source} source @param {string} _name @param {{ label: string }} [kind] */
export async function openZip(source, _name, kind) {
  const { start, header } = await crxStart(source);
  const end = await endRecord(source);
  if (end.disk !== 0) throw new Error("Split ZIP archives are not read here.");
  // Bytes in front of the ZIP (a CRX header, a self-extractor) shift every offset.
  const shift = end.pos - end.size - end.offset;
  if (end.pos - end.size < start) throw new Error("The ZIP's central directory is damaged.");
  const cd = await source.read(end.pos - end.size, end.size);
  /** @type {ZipEntry[]} */
  const listed = [];
  for (let i = 0, n = 0; i + 46 <= cd.length; n++) {
    if (!at(cd, i, "PK\x01\x02")) throw new Error("The ZIP's central directory is damaged.");
    const flags = u16(cd, i + 8);
    const method = u16(cd, i + 10);
    const nameLength = u16(cd, i + 28);
    const extraLength = u16(cd, i + 30);
    const raw = cd.subarray(i + 46, i + 46 + nameLength);
    const wide = { size: u32(cd, i + 24), packed: u32(cd, i + 20), offset: u32(cd, i + 42) };
    const more = extras(cd.subarray(i + 46 + nameLength, i + 46 + nameLength + extraLength), wide);
    const name = flags & 0x800 ? text(raw) : (more.name ?? legacyName(raw));
    const host = (cd[i + 5] ?? 0) & 0xff;
    const attrs = u32(cd, i + 38);
    const mode = host === 3 ? attrs >>> 16 : 0;
    const folder =
      name.endsWith("/") || (mode & 0o170000) === 0o040000 || (host !== 3 && attrs & 0x10);
    const real = method === 99 && more.aes !== undefined ? more.aes : method;
    /** @type {ZipEntry} */
    const entry = {
      path: cleanPath(name),
      kind: folder ? "folder" : (mode & 0o170000) === 0o120000 ? "link" : "file",
      size: folder ? 0 : wide.size,
      packed: wide.packed,
      method: METHODS[real]?.[0] ?? `Method ${real}`,
      offset: wide.offset + shift,
      method_: real,
      crc: u32(cd, i + 16),
      flags,
    };
    const date = more.date ?? dosDate(u16(cd, i + 14), u16(cd, i + 12));
    if (date) entry.date = date;
    if (flags & 1) entry.encrypted = true;
    if (!folder && real !== 0 && real !== 14 && !METHODS[real]?.[1])
      entry.refusal = `${entry.method} decompression is not available.`;
    listed.push(entry);
    i += 46 + nameLength + extraLength + u16(cd, i + 32);
    if (n % 5000 === 4999) await pause();
  }

  /** The entry's data as stored, from its local header on. @param {ZipEntry} entry */
  const dataStart = async (entry) => {
    const local = await source.read(entry.offset, 30);
    if (!at(local, 0, "PK\x03\x04"))
      throw new Error(`The local header of ${entry.path} is damaged.`);
    return entry.offset + 30 + u16(local, 26) + u16(local, 28);
  };

  /** @param {ZipEntry} entry @param {number} limit */
  const read = async (entry, limit) => {
    if (entry.kind === "folder") return new Uint8Array(0);
    if (entry.encrypted) throw new Error(ENCRYPTED);
    if (entry.refusal) throw new Error(entry.refusal);
    const from = await dataStart(entry);
    const packed = entry.packed ?? 0;
    /** @type {Uint8Array} */
    let out;
    if (entry.method_ === 0) out = await source.read(from, Math.min(packed, limit));
    else if (entry.method_ === 14) {
      const head = await source.read(from, 4);
      const props = await source.read(from + 4, u16(head, 2));
      const input = inputFrom(source, from + 4 + u16(head, 2), packed - 4 - u16(head, 2));
      const chunks = (async function* () {
        try {
          yield* lzmaRaw(input, { props, size: entry.size });
        } catch (error) {
          throw named("LZMA", error);
        }
      })();
      out = await collect(chunks, limit);
    } else {
      const codec = /** @type {string} */ (METHODS[entry.method_]?.[1]);
      out = await collect(decodeStream(codec, inputFrom(source, from, packed)), limit);
    }
    if (limit >= entry.size) {
      if (out.length !== entry.size)
        throw new Error(`${entry.path} is shorter than its size: the archive is damaged.`);
      if (crc32(out) !== entry.crc)
        throw new Error(`${entry.path} does not match its CRC: the archive is damaged.`);
    }
    return out;
  };

  // Link targets are the links' data: read them now, while there are few.
  const links = listed.filter((e) => e.kind === "link");
  if (links.length <= 256)
    for (const link of links)
      if ((link.packed ?? 0) <= 4096)
        link.link = await read({ ...link, kind: "file" }, 4096).then(text, () => "");

  const details = [];
  if (header) details.push(row("Header", header));
  if (end.comment.length) details.push(row("Comment", legacyName(end.comment)));
  return {
    format: kind?.label ?? "ZIP",
    entries: withFolders(listed),
    details,
    read: (/** @type {Entry} */ entry, limit = Number.POSITIVE_INFINITY) =>
      read(/** @type {ZipEntry} */ (entry), limit),
  };
}
