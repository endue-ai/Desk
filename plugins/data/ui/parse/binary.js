// What the binary formats share: big-endian unsigned integers of any size, a byte offset as the hex
// dump's row and column (16 bytes a row), and a date as ISO 8601 text.

/** Bytes a hex dump row holds. */
export const ROW = 16;

/**
 * An unsigned big-endian integer of `size` bytes at `at`; a RangeError past the end.
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} size
 */
export function readUint(bytes, at, size) {
  if (at < 0 || at + size > bytes.length) throw new RangeError("past the end");
  let value = 0n;
  for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(bytes[at + i] ?? 0);
  return value;
}

/** The hex dump's 1-based row and column of a byte offset. */
export const bytesPosition = (/** @type {number} */ offset) => ({
  line: Math.floor(offset / ROW) + 1,
  col: (offset % ROW) + 1,
});

/**
 * Milliseconds since 1970 as ISO 8601 in UTC, without zero milliseconds.
 * @param {number} ms
 */
export function dateText(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(ms);
  return date.toISOString().replace(".000Z", "Z");
}
