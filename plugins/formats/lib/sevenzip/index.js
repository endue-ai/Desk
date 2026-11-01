// 7z: the start header names where the header lies (at the end); the header, plain or itself
// encoded, lists folders (coder chains over pack streams) and files. Nothing packed is read until an
// entry is: a file's folder is decoded from its start and the files before it skipped.

import { crc32 } from "../codecs/checksums.js";
import { collect } from "../codecs/index.js";
import { cleanPath, ENCRYPTED, withFolders } from "./archive.js";
import { at, u32, u64, utf8 } from "./bytes.js";
import { encrypted, folderChunks, methodOf } from "./folders.js";
import { parseHeader } from "./header.js";

/** @typedef {import("./archive.js").Source} Source */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {import("./header.js").Streams} Streams */
/** @typedef {{ folder: number, offset: number, crc?: number }} Place where a file's data lies */

const START = 32;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

/** The bytes of folder 0 of `streams`, checked: an encoded header. @param {Source} source @param {Streams} streams */
async function decodedHeader(source, streams) {
  const folder = streams.folders[0];
  if (!folder) throw new Error("The 7z header is damaged.");
  if (encrypted(folder)) throw new Error("The 7z's file list is encrypted.");
  const bytes = await collect(folderChunks(source, streams, 0, START));
  if (folder.crc !== undefined && crc32(bytes) !== folder.crc)
    throw new Error("The 7z header's CRC does not match.");
  return bytes;
}

/**
 * @param {Source} source @param {string} name @param {{ label?: string }} [kind]
 * @returns {Promise<Archive>}
 */
export async function openSevenZip(source, name, kind) {
  void name;
  const start = await source.read(0, START);
  if (start.length < START || !at(start, 0, "7z\xbc\xaf\x27\x1c"))
    throw new Error("This is not a 7z archive.");
  if (crc32(start.subarray(12, 32)) !== u32(start, 8))
    throw new Error("The 7z start header is damaged.");
  const nextOffset = u64(start, 12);
  const nextSize = u64(start, 20);
  const format = kind?.label ?? "7z";
  if (nextSize === 0)
    return { format, entries: [], details: [], read: async () => new Uint8Array(0) };
  if (START + nextOffset + nextSize > source.size)
    throw new Error("The 7z archive is cut short: its header lies past the end of the file.");
  let bytes = await source.read(START + nextOffset, nextSize);
  if (crc32(bytes) !== u32(start, 28)) throw new Error("The 7z header's CRC does not match.");
  let header = parseHeader(bytes);
  let encoded = false;
  for (let depth = 0; "encoded" in header; depth++) {
    if (depth > 4) throw new Error("The 7z header is damaged.");
    encoded = true;
    bytes = await decodedHeader(source, header.encoded);
    header = parseHeader(bytes);
  }
  const streams = header.main ?? {
    packPos: 0,
    packSizes: [],
    folders: [],
    counts: [],
    sizes: [],
    crcs: [],
  };

  /** @type {Map<Entry, Place>} */
  const places = new Map();
  /** @type {Entry[]} */
  const listed = [];
  let folder = 0;
  let inFolder = 0;
  let offset = 0;
  let stream = 0;
  for (const file of header.files) {
    if (file.anti) continue;
    const mode = file.attrib !== undefined && file.attrib & 0x8000 ? file.attrib >>> 16 : 0;
    /** @type {Entry} */
    const entry = { path: cleanPath(file.name), kind: "file", size: 0 };
    if (file.date) entry.date = file.date;
    if (file.empty) {
      const dir = !file.emptyFile || (file.attrib ?? 0) & 0x10 || (mode & S_IFMT) === S_IFDIR;
      entry.kind = dir ? "folder" : "file";
    } else {
      while (folder < streams.folders.length && streams.counts[folder] === 0) folder++;
      const f = streams.folders[folder];
      if (!f) throw new Error("The 7z header is damaged.");
      entry.size = streams.sizes[stream] ?? 0;
      entry.method = methodOf(f);
      if (inFolder === 0)
        entry.packed = f.packed.reduce((n, _, j) => {
          let first = 0;
          for (let k = 0; k < folder; k++) first += streams.folders[k]?.packed.length ?? 0;
          return n + (streams.packSizes[first + j] ?? 0);
        }, 0);
      if (encrypted(f)) {
        entry.encrypted = true;
        entry.refusal = ENCRYPTED;
      }
      if ((mode & S_IFMT) === S_IFLNK) entry.kind = "link";
      places.set(entry, { folder, offset, crc: streams.crcs[stream] });
      stream++;
      offset += entry.size;
      if (++inFolder >= (streams.counts[folder] ?? 0)) {
        folder++;
        inFolder = 0;
        offset = 0;
      }
    }
    if (entry.path) listed.push(entry);
  }

  /** Read one entry's bytes from its folder. @param {Entry} entry @param {number} limit */
  const read = async (entry, limit) => {
    if (entry.encrypted) throw new Error(ENCRYPTED);
    const place = places.get(entry);
    if (!place || entry.size === 0) return new Uint8Array(0);
    const want = Math.min(entry.size, limit);
    const out = new Uint8Array(want);
    let got = 0;
    let skip = place.offset;
    for await (const chunk of folderChunks(source, streams, place.folder, START)) {
      let part = chunk;
      if (skip > 0) {
        if (part.length <= skip) {
          skip -= part.length;
          continue;
        }
        part = part.subarray(skip);
        skip = 0;
      }
      const take = Math.min(part.length, want - got);
      out.set(part.subarray(0, take), got);
      got += take;
      if (got >= want) break;
    }
    if (got < want) throw new Error("The 7z block ends early.");
    if (want === entry.size && place.crc !== undefined && crc32(out) !== place.crc)
      throw new Error(`The CRC of ${entry.path} does not match.`);
    return out;
  };

  /** Each wanted entry, decoding every folder once. @type {NonNullable<Archive["each"]>} */
  const each = async (wanted, visit) => {
    /** @type {Map<number, Array<[Entry, Place]>>} */
    const byFolder = new Map();
    for (const entry of wanted) {
      const place = places.get(entry);
      if (!place || entry.size === 0 || entry.encrypted) {
        if (entry.encrypted) throw new Error(ENCRYPTED);
        await visit(entry, new Uint8Array(0));
        continue;
      }
      const list = byFolder.get(place.folder) ?? [];
      list.push([entry, place]);
      byFolder.set(place.folder, list);
    }
    for (const [index, list] of [...byFolder].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => a[1].offset - b[1].offset);
      let position = 0;
      let next = 0;
      /** @type {Uint8Array[]} */
      let parts = [];
      let have = 0;
      for await (const chunk of folderChunks(source, streams, index, START)) {
        let at = 0;
        while (at < chunk.length && next < list.length) {
          const [entry, place] = /** @type {[Entry, Place]} */ (list[next]);
          const end = place.offset + entry.size;
          if (position + at < place.offset) {
            at = Math.min(chunk.length, place.offset - position);
            continue;
          }
          const take = Math.min(chunk.length - at, end - (position + at));
          parts.push(chunk.subarray(at, at + take));
          have += take;
          at += take;
          if (have === entry.size) {
            const bytes = collectParts(parts, have);
            if (place.crc !== undefined && crc32(bytes) !== place.crc)
              throw new Error(`The CRC of ${entry.path} does not match.`);
            await visit(entry, bytes);
            parts = [];
            have = 0;
            next++;
          }
        }
        position += chunk.length;
        if (next >= list.length) break;
      }
      if (next < list.length) throw new Error("The 7z block ends early.");
    }
  };

  const entries = withFolders(listed);
  await resolveLinks(entries, each);
  const solid = streams.counts.some((n) => n > 1);
  return {
    format,
    entries,
    details: [
      { label: "Header", value: encoded ? "Encoded" : "Plain" },
      { label: "Solid", value: solid ? "Yes" : "No" },
      { label: "Blocks", value: String(streams.folders.length) },
    ],
    read: (entry, limit = Number.POSITIVE_INFINITY) => read(entry, limit),
    each,
  };
}

/** @param {Uint8Array[]} parts @param {number} size */
function collectParts(parts, size) {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A link's target is its data. Read the targets in one pass when there are few links and they are
 * small; otherwise the link says its target is not read.
 * @param {Entry[]} entries @param {NonNullable<Archive["each"]>} each
 */
async function resolveLinks(entries, each) {
  const links = entries.filter((e) => e.kind === "link");
  if (links.length === 0) return;
  if (links.length > 256 || links.some((l) => l.size > 4096 || l.encrypted)) {
    for (const link of links) link.refusal = "The link's target is not read.";
    return;
  }
  await each(links, async (entry, bytes) => {
    entry.link = utf8(bytes);
    entry.size = 0;
  });
}
