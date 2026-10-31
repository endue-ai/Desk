// Shared by the listing-only readers (ARJ, LHA): an archive of header entries whose stored ones can
// be read straight from the file, and the compressed ones refused with the format's sentence.
import { withFolders } from "./archive.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {import("./archive.js").Detail} Detail */
/** @typedef {Entry & { start?: number }} Placed an entry with where its stored data starts */

/**
 * @param {Source} source @param {string} format @param {Placed[]} listed @param {string} refusal
 * @param {Detail[]} [details]
 * @returns {Archive}
 */
export function listedArchive(source, format, listed, refusal, details = []) {
  return {
    format,
    entries: withFolders(listed),
    details,
    refusal,
    read: async (entry, limit = Number.POSITIVE_INFINITY) => {
      const e = /** @type {Placed} */ (entry);
      if (e.kind === "folder") return new Uint8Array(0);
      if (e.refusal) throw new Error(e.refusal);
      if (e.start === undefined) throw new Error(refusal);
      return (await source.read(e.start, Math.min(e.size, limit))).slice();
    },
  };
}

/** Names in the encodings old archivers wrote: UTF-8, else Shift_JIS, else Latin-1. @param {Uint8Array} b */
export function oldName(b) {
  for (const label of ["utf-8", "shift_jis"]) {
    try {
      return new TextDecoder(label, { fatal: true }).decode(b);
    } catch {
      // the next encoding
    }
  }
  return String.fromCharCode(...b);
}
