// Sources: a file read by byte ranges. The plugin never holds a whole archive in memory: formats ask
// for the ranges they need (a ZIP's end, a tar's next header), and a cache of 64 KiB blocks keeps
// neighbouring reads from going back over the bridge.

/**
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * read answers exactly min(length, size - offset) bytes.
 */

/** @param {Uint8Array} bytes @returns {Source} */
export function memorySource(bytes) {
  return {
    size: bytes.length,
    read: async (offset, length) =>
      bytes.subarray(Math.min(offset, bytes.length), Math.min(bytes.length, offset + length)),
  };
}

const BLOCK = 64 * 1024;
const KEEP = 64;
const MOST = 4 * 1024 * 1024;

/**
 * A source over `fetch(offset, length)`, which answers at most `length` bytes from `offset`. Reads go
 * out in whole blocks, at most 4 MiB per call, and the last 64 blocks stay cached.
 * @param {(offset: number, length: number) => Promise<Uint8Array>} fetch
 * @param {number} size
 * @returns {Source}
 */
export function cachedSource(fetch, size) {
  /** @type {Map<number, Uint8Array>} */
  const blocks = new Map();
  const keep = (/** @type {number} */ index, /** @type {Uint8Array} */ block) => {
    blocks.delete(index);
    blocks.set(index, block);
    while (blocks.size > KEEP) blocks.delete(/** @type {number} */ (blocks.keys().next().value));
  };
  /** Fetch blocks first..last (inclusive), all missing, in calls of at most MOST bytes. */
  const fill = async (/** @type {number} */ first, /** @type {number} */ last) => {
    for (let index = first; index <= last; ) {
      const count = Math.min(last - index + 1, MOST / BLOCK);
      const offset = index * BLOCK;
      const length = Math.min(count * BLOCK, size - offset);
      const got = await fetch(offset, length);
      if (got.length < length) throw new Error("The file is shorter than it was.");
      for (let i = 0; i < count; i++) keep(index + i, got.subarray(i * BLOCK, (i + 1) * BLOCK));
      index += count;
    }
  };
  /** A long read (a large directory, an entry) goes straight through, in calls of MOST bytes. */
  const direct = async (/** @type {number} */ start, /** @type {number} */ end) => {
    const out = new Uint8Array(end - start);
    for (let at = start; at < end; ) {
      const got = await fetch(at, Math.min(MOST, end - at));
      if (got.length === 0) throw new Error("The file is shorter than it was.");
      out.set(got, at - start);
      at += got.length;
    }
    return out;
  };
  return {
    size,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(offset, size));
      const end = Math.min(size, start + Math.max(0, length));
      if (end <= start) return new Uint8Array(0);
      const first = Math.floor(start / BLOCK);
      const last = Math.floor((end - 1) / BLOCK);
      if (last - first >= KEEP / 2) return direct(start, end);
      for (let index = first; index <= last; index++) {
        if (blocks.has(index)) continue;
        let until = index;
        while (until < last && !blocks.has(until + 1)) until++;
        await fill(index, until);
        index = until;
      }
      if (first === last) {
        const block = /** @type {Uint8Array} */ (blocks.get(first));
        keep(first, block);
        return block.subarray(start - first * BLOCK, end - first * BLOCK);
      }
      const out = new Uint8Array(end - start);
      for (let index = first; index <= last; index++) {
        const block = /** @type {Uint8Array} */ (blocks.get(index));
        const from = Math.max(start, index * BLOCK);
        const to = Math.min(end, (index + 1) * BLOCK);
        out.set(block.subarray(from - index * BLOCK, to - index * BLOCK), from - start);
      }
      return out;
    },
  };
}

/** Part of a source, as a source of its own. @param {Source} source @param {number} offset @param {number} length */
export function sliceSource(source, offset, length) {
  const size = Math.max(0, Math.min(length, source.size - offset));
  return /** @type {Source} */ ({
    size,
    read: (at, n) => source.read(offset + Math.min(at, size), Math.max(0, Math.min(n, size - at))),
  });
}
