// Archives whose entries follow each other in one stream (tar, cpio), read through a decoder or
// straight from the file. Listing reads every header once; reading an entry starts the stream again
// and skips to it; `each` reads many entries in one pass.
import { collect, pause } from "@endue-ai/formats/codecs/index.js";

/** @typedef {import("@endue-ai/formats/codecs/input.js").Input} Input */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {Entry & { start: number }} Placed an entry with where its data starts in the stream */
/** @typedef {(input: Input) => AsyncGenerator<Placed>} Records */

/**
 * @param {string} format the label people read: "tar (gzip)"
 * @param {() => Input} open a fresh input from the stream's start
 * @param {Records} records the entries in stream order; after each yield the generator skips
 *   whatever data the reader left
 * @param {(entries: Placed[]) => Placed[]} [finish] folders added, duplicates resolved
 * @returns {Promise<Archive>}
 */
export async function streamedArchive(format, open, records, finish = (e) => e) {
  /** @type {Placed[]} */
  const listed = [];
  let count = 0;
  for await (const entry of records(open())) {
    listed.push(entry);
    if (++count % 2000 === 0) await pause();
  }
  const entries = finish(listed);

  /** @param {Placed} entry @param {number} limit */
  const read = async (entry, limit) => {
    if (entry.kind === "folder") return new Uint8Array(0);
    const input = open();
    await input.skip(entry.start);
    const length = Math.min(entry.size, limit);
    if (!(await input.need(length))) throw input.ends();
    return input.take(length).slice();
  };

  return {
    format,
    entries,
    details: [],
    read: (entry, limit = Number.POSITIVE_INFINITY) => read(/** @type {Placed} */ (entry), limit),
    each: async (wanted, visit) => {
      /** @type {Map<number, Placed>} */
      const left = new Map(
        wanted.map((e) => [/** @type {Placed} */ (e).start, /** @type {Placed} */ (e)]),
      );
      if (left.size === 0) return;
      const input = open();
      for await (const record of records(input)) {
        const entry = left.get(record.start);
        if (!entry || entry.path !== record.path) continue;
        left.delete(record.start);
        const bytes = entry.kind === "folder" ? new Uint8Array(0) : await input.read(entry.size);
        await visit(entry, bytes);
        if (left.size === 0) return;
      }
    },
  };
}

export { collect };
