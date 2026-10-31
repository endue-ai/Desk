// A file the readers see as bytes at offsets, without holding it: ranges come through fs.read in
// blocks of 64 KiB, at most 1 MiB per call, and each block is read once. A film's header, its tags at
// the end and a cover in between cost a few calls; the gigabytes between them are never asked for.

const BLOCK = 64 * 1024;
const PER_CALL = 16;

/**
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * @typedef {(offset: number, length: number) => Promise<Uint8Array>} Fetch
 */

/**
 * @param {number} size the file's size in bytes
 * @param {Fetch} fetch reads `length` bytes at `offset` (fewer at the end)
 * @returns {Source & { seed(offset: number, bytes: Uint8Array): void }}
 */
export function createSource(size, fetch) {
  /** @type {Map<number, Uint8Array>} */
  const blocks = new Map();

  /** Fetch the blocks from `first` to `last` that are missing, in runs of at most PER_CALL. */
  const load = async (/** @type {number} */ first, /** @type {number} */ last) => {
    const calls = [];
    for (let i = first; i <= last; i++) {
      if (blocks.has(i)) continue;
      let end = i;
      while (end < last && end - i + 1 < PER_CALL && !blocks.has(end + 1)) end++;
      const from = i;
      const to = end;
      calls.push(
        fetch(from * BLOCK, (to - from + 1) * BLOCK).then((bytes) => {
          for (let b = from; b <= to; b++) {
            const at = (b - from) * BLOCK;
            blocks.set(b, bytes.subarray(at, Math.min(bytes.length, at + BLOCK)));
          }
        }),
      );
      i = end;
    }
    await Promise.all(calls);
  };

  return {
    size,
    async read(offset, length) {
      const start = Math.max(0, Math.min(size, Math.floor(offset)));
      const end = Math.max(start, Math.min(size, Math.floor(offset + length)));
      if (end === start) return new Uint8Array(0);
      const first = Math.floor(start / BLOCK);
      const last = Math.floor((end - 1) / BLOCK);
      await load(first, last);
      const out = new Uint8Array(end - start);
      let filled = 0;
      for (let b = first; b <= last; b++) {
        const block = blocks.get(b) ?? new Uint8Array(0);
        const from = b === first ? start - b * BLOCK : 0;
        const part = block.subarray(from, Math.min(block.length, end - b * BLOCK));
        out.set(part, filled);
        filled += part.length;
        if (block.length < BLOCK) break;
      }
      return filled === out.length ? out : out.subarray(0, filled);
    },
    seed(offset, bytes) {
      if (offset % BLOCK !== 0) return;
      for (let at = 0; at < bytes.length; at += BLOCK) {
        const part = bytes.subarray(at, at + BLOCK);
        // A short block is only whole at the end of the file.
        if (part.length < BLOCK && offset + at + part.length < size) break;
        blocks.set((offset + at) / BLOCK, part);
      }
    },
  };
}

/**
 * Bytes in memory as a source; `size` may claim more than there is (the rest reads as nothing), and
 * `onRead` hears every range asked for. Tests and the plugin's own decoders use it.
 * @param {Uint8Array} bytes
 * @param {{ size?: number, onRead?: (offset: number, length: number) => unknown }} [options]
 * @returns {Source}
 */
export function memorySource(bytes, options = {}) {
  const size = options.size ?? bytes.length;
  return createSource(size, async (offset, length) => {
    options.onRead?.(offset, length);
    return bytes.subarray(Math.min(offset, bytes.length), Math.min(bytes.length, offset + length));
  });
}
