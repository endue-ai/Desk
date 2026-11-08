// Sources: a disk read by byte ranges, `{ size, read(offset, length) }`, where read answers exactly
// min(length, size - offset) bytes. Containers build the virtual disk as a source of extents; file
// systems read their partition through a slice of it, behind a small block cache.

/**
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * @typedef {{ length: number, at?: number, bytes?: Uint8Array }} Extent where the byte asked for
 * lives and how many bytes from it go on the same way: at `at` in the image, in decoded `bytes`
 * (from their start), or nowhere (zeros) when neither is given.
 */

/** @param {Uint8Array} bytes @returns {Source} */
export const memorySource = (bytes) => ({
  size: bytes.length,
  read: async (offset, length) =>
    bytes.subarray(Math.min(offset, bytes.length), Math.min(bytes.length, offset + length)),
});

/** Part of a source, as a source of its own. @param {Source} source @param {number} offset @param {number} length */
export function sliceSource(source, offset, length) {
  const size = Math.max(0, Math.min(length, source.size - offset));
  return /** @type {Source} */ ({
    size,
    read: (at, n) => source.read(offset + Math.min(at, size), Math.max(0, Math.min(n, size - at))),
  });
}

/**
 * A virtual disk of `size` bytes whose bytes `locate` finds in `image`. Neighbouring extents that
 * follow each other in the image are read in one call; an extent past the image's end fails with a
 * sentence that names the format.
 * @param {Source} image @param {number} size @param {(offset: number) => Promise<Extent>} locate
 * @param {string} format "VHD", "VMDK", ...
 * @returns {Source}
 */
export function extentSource(image, size, locate, format) {
  return {
    size,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(offset, size));
      const end = Math.min(size, start + Math.max(0, length));
      const out = new Uint8Array(end - start);
      let runFrom = -1;
      let runAt = 0;
      let runLength = 0;
      const flush = async () => {
        if (!runLength) return;
        const bytes = await image.read(runAt, runLength);
        if (bytes.length < runLength)
          throw new Error(`The ${format} is cut short: its data goes past the end of the file.`);
        out.set(bytes, runFrom - start);
        runLength = 0;
      };
      for (let pos = start; pos < end; ) {
        const extent = await locate(pos);
        const n = Math.min(Math.max(1, extent.length), end - pos);
        if (extent.at !== undefined) {
          if (!runLength || runAt + runLength !== extent.at) {
            await flush();
            runFrom = pos;
            runAt = extent.at;
          }
          runLength += n;
        } else {
          await flush();
          if (extent.bytes) out.set(extent.bytes.subarray(0, n), pos - start);
        }
        pos += n;
      }
      await flush();
      return out;
    },
  };
}

const BLOCK = 16 * 1024;
const KEEP = 256;

/**
 * A source that keeps the last 256 blocks of 16 KiB it read (4 MiB): inodes, tables and records
 * sit close together, while directories scatter, so a small block reads less around each one.
 * Reads of 2 MiB and more go straight through.
 * @param {Source} source @returns {Source}
 */
export function cachedSource(source) {
  /** @type {Map<number, Promise<Uint8Array>>} */
  const blocks = new Map();
  const block = (/** @type {number} */ index) => {
    let got = blocks.get(index);
    if (got) blocks.delete(index);
    else {
      got = source.read(index * BLOCK, BLOCK);
      got.catch(() => blocks.delete(index));
    }
    blocks.set(index, got);
    while (blocks.size > KEEP) blocks.delete(/** @type {number} */ (blocks.keys().next().value));
    return got;
  };
  return {
    size: source.size,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(offset, source.size));
      const end = Math.min(source.size, start + Math.max(0, length));
      if (end - start >= (KEEP * BLOCK) / 2) return source.read(start, end - start);
      const first = Math.floor(start / BLOCK);
      const last = Math.floor((end - 1) / BLOCK);
      if (end <= start) return new Uint8Array(0);
      if (first === last)
        return (await block(first)).subarray(start - first * BLOCK, end - first * BLOCK);
      const out = new Uint8Array(end - start);
      for (let index = first; index <= last; index++) {
        const bytes = await block(index);
        const from = Math.max(start, index * BLOCK);
        const to = Math.min(end, (index + 1) * BLOCK);
        out.set(bytes.subarray(from - index * BLOCK, to - index * BLOCK), from - start);
      }
      return out;
    },
  };
}

/**
 * Exactly `length` bytes at `offset`, or a sentence when the source ends first.
 * @param {Source} source @param {number} offset @param {number} length @param {string} what
 */
export async function readExact(source, offset, length, what) {
  const bytes = await source.read(offset, length);
  if (bytes.length < length) throw new Error(`${what} goes past the end of the image.`);
  return bytes;
}
