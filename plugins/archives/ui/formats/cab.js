// Microsoft cabinet files: a header, folders (runs of compressed data blocks) and files that are
// ranges of a folder's decoded bytes. Stored and MSZIP folders are read; MSZIP blocks go through
// DecompressionStream, each with the previous 32 KiB put in front as a stored deflate block, since a
// block may copy from what the one before it decoded.

import { collect, decodeStream } from "@endue-ai/formats/codecs/index.js";
import { inputOf } from "@endue-ai/formats/codecs/input.js";
import { at, Cursor, cp437, dosDate, text } from "../bytes.js";
import { cleanPath, row, withFolders } from "./archive.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {{ start: number, blocks: number, type: number }} Folder */
/** @typedef {Entry & { folder: number, offset: number }} CabEntry */

const METHODS = ["Stored", "MSZIP", "Quantum", "LZX"];
const HISTORY = 32 * 1024;

/** A NUL-terminated string at the cursor. @param {Cursor} c */
function zstring(c) {
  const end = c.b.indexOf(0, c.pos);
  if (end < 0) throw new Error("The cabinet header ends early.");
  const bytes = c.bytes(end - c.pos);
  c.skip(1);
  return bytes;
}

/**
 * One MSZIP block: "CK" and a deflate stream that may refer back into `history`.
 * @param {Uint8Array} data @param {Uint8Array} history @param {number} size
 */
async function inflateBlock(data, history, size) {
  if (data[0] !== 0x43 || data[1] !== 0x4b)
    throw new Error("An MSZIP block of the cabinet is damaged.");
  const body = data.subarray(2);
  const prefix = new Uint8Array(history.length ? 5 + history.length : 0);
  if (history.length) {
    // A stored, non-final deflate block: BFINAL 0, BTYPE 00, then LEN and its complement.
    prefix[1] = history.length & 0xff;
    prefix[2] = history.length >> 8;
    prefix[3] = ~history.length & 0xff;
    prefix[4] = (~history.length >> 8) & 0xff;
    prefix.set(history, 5);
  }
  const run = async (/** @type {Uint8Array} */ tail) => {
    const crafted = new Uint8Array(prefix.length + body.length + tail.length);
    crafted.set(prefix);
    crafted.set(body, prefix.length);
    crafted.set(tail, prefix.length + body.length);
    return collect(decodeStream("deflate", inputOf(crafted)), history.length + size);
  };
  let out;
  try {
    out = await run(new Uint8Array(0));
  } catch {
    // A block that ends with a sync flush and no final block: close it with an empty final one.
    out = await run(new Uint8Array([1, 0, 0, 0xff, 0xff]));
  }
  if (out.length !== history.length + size)
    throw new Error("An MSZIP block of the cabinet is damaged.");
  return out.subarray(history.length);
}

/** @param {Source} source @param {string} name @returns {Promise<Archive>} */
export async function openCab(source, name) {
  const head = await source.read(0, Math.min(source.size, 64 * 1024));
  if (!at(head, 0, "MSCF")) throw new Error(`${name} has no cabinet header.`);
  const c = new Cursor(head, 16);
  const filesAt = c.u32();
  c.skip(6); // reserved, version
  const folderCount = c.u16();
  const fileCount = c.u16();
  const flags = c.u16();
  c.skip(4); // set id, index in set
  let folderReserve = 0;
  let dataReserve = 0;
  if (flags & 4) {
    const headerReserve = c.u16();
    folderReserve = c.u8();
    dataReserve = c.u8();
    c.skip(headerReserve);
  }
  // The previous and next cabinet's names and disks.
  for (const linked of [flags & 1, flags & 2]) if (linked) for (const _ of [0, 1]) zstring(c);
  /** @type {Folder[]} */
  const folders = [];
  for (let i = 0; i < folderCount; i++) {
    folders.push({ start: c.u32(), blocks: c.u16(), type: c.u16() & 0x0f });
    c.skip(folderReserve);
  }
  const table = await source.read(filesAt, Math.min(source.size - filesAt, fileCount * 272 + 16));
  const f = new Cursor(table);
  /** @type {CabEntry[]} */
  const listed = [];
  for (let i = 0; i < fileCount; i++) {
    const size = f.u32();
    const offset = f.u32();
    const folder = f.u16();
    const date = f.u16();
    const time = f.u16();
    const attributes = f.u16();
    const raw = zstring(f);
    /** @type {CabEntry} */
    const entry = {
      path: cleanPath(attributes & 0x80 ? text(raw) : cp437(raw)),
      kind: "file",
      size,
      folder,
      offset,
    };
    const when = dosDate(date, time);
    if (when) entry.date = when;
    const type = folders[folder]?.type;
    if (type === undefined)
      entry.refusal = "This file continues in another cabinet, which is not read.";
    else {
      entry.method = METHODS[type] ?? `Method ${type}`;
      if (type > 1) entry.refusal = `${entry.method} decompression is not available.`;
    }
    listed.push(entry);
  }

  /**
   * The folder's decoded bytes from 0 to `end`, block by block.
   * @param {Folder} folder @param {number} end
   * @returns {AsyncGenerator<Uint8Array>}
   */
  async function* decoded(folder, end) {
    let at = folder.start;
    let made = 0;
    let history = new Uint8Array(0);
    for (let i = 0; i < folder.blocks && made < end; i++) {
      const block = await source.read(at, 8 + dataReserve);
      if (block.length < 8) throw new Error("The cabinet ends early.");
      const packed = block[4] | (block[5] << 8);
      const size = block[6] | (block[7] << 8);
      const data = await source.read(at + 8 + dataReserve, packed);
      if (data.length < packed) throw new Error("The cabinet ends early.");
      at += 8 + dataReserve + packed;
      const out = folder.type === 0 ? data : await inflateBlock(data, history, size);
      if (folder.type === 1) {
        const joined = new Uint8Array(Math.min(HISTORY, history.length + out.length));
        const keep = joined.length - out.length;
        if (keep > 0) joined.set(history.subarray(history.length - keep));
        joined.set(out.subarray(Math.max(0, out.length - joined.length)), Math.max(0, keep));
        history = joined;
      }
      made += out.length;
      yield out;
    }
  }

  /** The entries' bytes from one pass over their folder. @param {CabEntry[]} wanted @param {(e: CabEntry, b: Uint8Array) => Promise<unknown>} visit */
  const pass = async (wanted, visit, limit = Number.POSITIVE_INFINITY) => {
    const byFolder = new Map();
    for (const e of wanted) {
      if (!byFolder.has(e.folder)) byFolder.set(e.folder, []);
      byFolder.get(e.folder).push(e);
    }
    for (const [index, group] of byFolder) {
      const folder = /** @type {Folder} */ (folders[index]);
      group.sort((a, b) => a.offset - b.offset);
      const ends = group.map((/** @type {CabEntry} */ e) => e.offset + Math.min(e.size, limit));
      /** @type {Map<CabEntry, Uint8Array>} */
      const parts = new Map(
        group.map((/** @type {CabEntry} */ e, /** @type {number} */ i) => [
          e,
          new Uint8Array((ends[i] ?? 0) - e.offset),
        ]),
      );
      let pos = 0;
      let next = 0;
      for await (const chunk of decoded(
        folder,
        ends.reduce((a, b) => Math.max(a, b), 0),
      )) {
        for (let i = next; i < group.length; i++) {
          const e = group[i];
          const end = ends[i] ?? 0;
          const from = Math.max(e.offset, pos);
          const to = Math.min(end, pos + chunk.length);
          if (from < to) parts.get(e)?.set(chunk.subarray(from - pos, to - pos), from - e.offset);
        }
        pos += chunk.length;
        while (next < group.length && (ends[next] ?? 0) <= pos) {
          const e = group[next++];
          await visit(e, /** @type {Uint8Array} */ (parts.get(e)));
        }
      }
      if (next < group.length) throw new Error("The cabinet ends before its files do.");
    }
  };

  const entries = withFolders(listed);
  return {
    format: "Cabinet",
    entries,
    details: [row("Folders", folderCount), row("Files", fileCount)],
    read: async (e, limit) => {
      const entry = /** @type {CabEntry} */ (e);
      if (entry.kind !== "file") return new Uint8Array(0);
      if (entry.refusal) throw new Error(entry.refusal);
      let out = new Uint8Array(0);
      await pass(
        [entry],
        async (_e, bytes) => {
          out = bytes;
        },
        limit,
      );
      return out;
    },
    each: async (wanted, visit) => {
      const files = /** @type {CabEntry[]} */ (
        wanted.filter((e) => e.kind === "file" && !e.refusal)
      );
      await pass(files, (e, bytes) => visit(e, bytes));
    },
  };
}
