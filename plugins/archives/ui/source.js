// Sources: a file read by byte ranges. The plugin never holds a whole archive in memory: formats ask
// for the ranges they need (a ZIP's end, a tar's next header), and the SDK's byteSource keeps a cache
// of 64 KiB blocks so neighbouring reads do not go back to the desk (files.js).

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

/** Part of a source, as a source of its own. @param {Source} source @param {number} offset @param {number} length */
export function sliceSource(source, offset, length) {
  const size = Math.max(0, Math.min(length, source.size - offset));
  return /** @type {Source} */ ({
    size,
    read: (at, n) => source.read(offset + Math.min(at, size), Math.max(0, Math.min(n, size - at))),
  });
}
