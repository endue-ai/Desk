// HFS+ forks: a file's data or resource fork is up to eight extents in its catalog record (or an
// attribute's fork data) and, past those, records in the extents-overflow file keyed by the
// file's ID, the fork and the first block they cover. A fork reads as a Source of its bytes.
import { u16be, u32be, u64be } from "../disk/bytes.js";
import { extentSource } from "../disk/source.js";
import { damaged } from "../disk/work.js";
import { leafRecords, openTree, split } from "./hfs-btree.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/** @typedef {{ start: number, count: number }} Extent in allocation blocks */
/** @typedef {{ size: number, blocks: number, extents: Extent[] }} Fork */

export const DATA = 0x00;
export const RESOURCE = 0xff;

/** An HFSPlusForkData (80 bytes) at `o`. @param {Uint8Array} b @param {number} o @returns {Fork} */
export function forkData(b, o) {
  return { size: u64be(b, o), blocks: u32be(b, o + 12), extents: extents(b, o + 16) };
}

/** Eight extent descriptors at `o`, the empty ones left out. @param {Uint8Array} b @param {number} o */
export function extents(b, o) {
  /** @type {Extent[]} */
  const list = [];
  for (let i = 0; i < 8; i++) {
    const count = u32be(b, o + 8 * i + 4);
    if (count) list.push({ start: u32be(b, o + 8 * i), count });
  }
  return list;
}

/**
 * The extents-overflow file, read once when a fork first needs it: every record, by file and fork.
 * @param {Source} volume @param {number} blockSize @param {Fork} file the extents file's own fork
 * @param {Work} work
 */
export function overflow(volume, blockSize, file, work) {
  /** @type {Promise<Map<string, { first: number, extents: Extent[] }[]>> | undefined} */
  let index;
  const load = async () => {
    /** @type {Map<string, { first: number, extents: Extent[] }[]>} */
    const map = new Map();
    if (!file.size) return map;
    const tree = await openTree(forkSource(volume, blockSize, file, "extents"), "extents");
    for await (const record of leafRecords(tree, work)) {
      const { key, data } = split(record);
      if (key.length < 10) continue;
      const id = `${u32be(key, 2)}:${key[0]}`;
      const list = map.get(id) ?? [];
      list.push({ first: u32be(key, 6), extents: extents(data, 0) });
      map.set(id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.first - b.first);
    return map;
  };
  /**
   * All of a fork's extents.
   * @param {number} id the file's catalog ID @param {number} type DATA or RESOURCE @param {Fork} fork
   * @returns {Promise<Extent[]>}
   */
  return async (id, type, fork) => {
    let have = fork.extents.reduce((n, e) => n + e.count, 0);
    if (have >= fork.blocks) return fork.extents;
    index ??= load();
    const more = (await index).get(`${id}:${type}`) ?? [];
    const all = [...fork.extents];
    for (const record of more) {
      if (record.first !== have) continue;
      all.push(...record.extents);
      have += record.extents.reduce((n, e) => n + e.count, 0);
      if (have >= fork.blocks) break;
    }
    if (have < fork.blocks)
      throw damaged("The HFS+ volume is damaged: a file's extents do not cover its blocks.");
    return all;
  };
}

/**
 * A fork as a Source of its `size` bytes.
 * @param {Source} volume @param {number} blockSize @param {{ size: number, extents: Extent[] }} fork
 * @param {string} what what the fork is, for errors @returns {Source}
 */
export function forkSource(volume, blockSize, fork, what) {
  /** @type {{ from: number, to: number, at: number }[]} */
  const runs = [];
  let pos = 0;
  for (const e of fork.extents) {
    const length = e.count * blockSize;
    runs.push({ from: pos, to: pos + length, at: e.start * blockSize });
    pos += length;
  }
  if (pos < fork.size)
    throw damaged(`The HFS+ volume is damaged: the ${what} is longer than its extents.`);
  for (const run of runs)
    if (run.at + (run.to - run.from) > volume.size)
      throw damaged(`The HFS+ volume is damaged: the ${what} lies past the end of the volume.`);
  return extentSource(
    volume,
    fork.size,
    async (offset) => {
      let lo = 0;
      let hi = runs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((runs[mid]?.from ?? 0) <= offset) lo = mid;
        else hi = mid - 1;
      }
      const run = /** @type {{ from: number, to: number, at: number }} */ (runs[lo]);
      return { at: run.at + (offset - run.from), length: run.to - offset };
    },
    "HFS+ volume",
  );
}

/** A name as HFSUniStr255 at `o` (UTF-16BE, its length first), "/" shown as ":" as macOS does. @param {Uint8Array} b @param {number} o */
export function uniName(b, o) {
  const n = Math.min(u16be(b, o), 255, Math.max(0, (b.length - o - 2) >> 1));
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(u16be(b, o + 2 + 2 * i));
  return s.replace(/\//g, ":");
}
