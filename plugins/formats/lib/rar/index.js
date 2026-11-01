// endue.formats' RAR reader: RAR 4 (2.9 and later) and RAR 5 archives listed and decoded from a
// Source, answering the Archive shape of endue.archives. Written from RARLAB's RAR 5.0 technote and
// libarchive's BSD-licensed RAR readers (see NOTICE); PPMd after the public-domain LZMA SDK.

import { reader } from "./decode.js";
import { ENCRYPTED, LOCKED, NOT_RAR, withFolders } from "./entries.js";
import { decodeRar4, list4 } from "./rar4/index.js";
import { list5 } from "./rar5/headers.js";
import { Decoder5 } from "./rar5/lz.js";

/** @typedef {import("./input.js").Source} Source */
/** @typedef {import("./entries.js").Entry} Entry */
/** @typedef {import("./entries.js").Detail} Detail */
/** @typedef {import("./decode.js").Options} Options */
/**
 * @typedef {{
 *   format: string,
 *   entries: Entry[],
 *   details: Detail[],
 *   note?: string,
 *   refusal?: string,
 *   read(entry: Entry, limit?: number): Promise<Uint8Array>,
 *   each(entries: Entry[], visit: (entry: Entry, bytes: Uint8Array) => Promise<unknown>): Promise<void>,
 * }} Archive
 */

export { DAMAGED, ENCRYPTED, LOCKED, NOT_RAR, OLD_METHOD, SPLIT } from "./entries.js";
export { TRUNCATED } from "./input.js";
export { CANCELLED } from "./pace.js";
export { BAD_HEADER_CRC } from "./rar5/headers.js";

const SFX = 1 << 20;
const FIVE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];

/** Where the signature is (at the start, or after a self-extracting module) and which format. @param {Source} source */
async function signature(source) {
  const head = await source.read(0, Math.min(source.size, SFX + 8));
  for (
    let at = head.indexOf(0x52);
    at >= 0 && at + 7 <= head.length;
    at = head.indexOf(0x52, at + 1)
  ) {
    if (head[at + 1] !== 0x61 || head[at + 2] !== 0x72 || head[at + 3] !== 0x21) continue;
    if (head[at + 4] !== 0x1a || head[at + 5] !== 0x07) continue;
    if (head[at + 6] === 0x00) return { offset: at, five: false };
    if (FIVE.every((b, i) => head[at + i] === b)) return { offset: at, five: true };
  }
  return undefined;
}

/**
 * Opens a RAR archive: its entries and details, `read` for one entry, `each` for several in one
 * pass. `options.signal` stops long decodes; `options.maxWindow` caps the dictionary in bytes.
 * @param {Source} source @param {Options} [options] @returns {Promise<Archive>}
 */
export async function openRar(source, options = {}) {
  const found = await signature(source);
  if (!found) throw new Error(NOT_RAR);
  const format = found.five ? "RAR 5" : "RAR 4";
  const { listed, info, cut } = found.five
    ? await list5(source, found.offset)
    : await list4(source, found.offset);
  /** @type {Detail[]} */
  const details = [{ label: "Solid", value: info.solid ? "Yes" : "No" }];
  if (found.offset > 0) details.push({ label: "Self-extracting", value: "Yes" });
  if (info.volume)
    details.push({ label: "Volume", value: info.first ? "First of a set" : "Part of a set" });
  if (info.recovery) details.push({ label: "Recovery record", value: "Yes" });
  if (
    listed.some(
      (item) => item.data && "blake" in item.data && item.data.blake && item.data.crc === undefined,
    )
  )
    details.push({ label: "Checksums", value: "BLAKE2sp, not checked" });
  if (cut) details.push({ label: "Damage", value: "The archive ends early." });
  const decoder = found.five
    ? (/** @type {number} */ size) => new Decoder5(size)
    : (/** @type {number} */ size) => decodeRar4(size);
  const { read, each } = reader(source, listed, decoder, options);
  /** @type {Archive} */
  const archive = {
    format,
    entries: withFolders(listed.map((item) => item.entry)),
    details,
    read,
    each,
  };
  if (info.locked) {
    archive.note = LOCKED;
    archive.refusal = ENCRYPTED;
  }
  return archive;
}
