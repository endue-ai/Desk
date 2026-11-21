// Where a place in a script is, in the four ways it is counted: the UTF-8 byte the server's parser
// reports (`byte`), the UTF-16 offset a JavaScript string and the editor use (`offset`), and the line
// and column the person reads (from 1, the column in UTF-16 units, as ui/sql/split.js counts it).
// The server's error cursor counts characters (code points); `ofCharacter` reads it. Pure: it runs
// in the parse worker and on the page alike.

/**
 * @typedef {{ byte: number, offset: number, line: number, column: number }} Position
 * @typedef {{
 *   at(byte: number): Position,
 *   ofOffset(offset: number): Position,
 *   ofCharacter(index: number): Position,
 *   byteOf(offset: number): number,
 *   characterOf(offset: number): number,
 *   bytes: number,
 * }} Positions
 */

/** The last index of `sorted` whose value is at most `value`, or -1. */
function lastAtMost(/** @type {ArrayLike<number>} */ sorted, /** @type {number} */ value) {
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (/** @type {number} */ (sorted[mid]) <= value) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The positions of `text`. Only characters past ASCII are kept, one entry each, so an ASCII script
 * costs its line starts and nothing else. A lone surrogate counts as U+FFFD, three bytes, as the
 * parser is sent it.
 * @param {string} text
 * @returns {Positions}
 */
export function createPositions(text) {
  /** @type {number[]} */
  const lines = [0];
  /** Per character past ASCII: its offset, its byte, its character index, its units and bytes. */
  /** @type {number[]} */
  const offsets = [];
  /** @type {number[]} */
  const bytes = [];
  /** @type {number[]} */
  const chars = [];
  /** @type {number[]} */
  const units = [];
  /** @type {number[]} */
  const widths = [];
  let byte = 0;
  let char = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      if (code === 10) lines.push(i + 1);
      byte++;
      char++;
      continue;
    }
    const next = text.charCodeAt(i + 1);
    const pair = code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
    const width = pair ? 4 : code < 0x800 ? 2 : 3;
    offsets.push(i);
    bytes.push(byte);
    chars.push(char);
    units.push(pair ? 2 : 1);
    widths.push(width);
    byte += width;
    char++;
    if (pair) i++;
  }
  const total = byte;

  const lineOf = (/** @type {number} */ offset) => {
    const at = Math.max(0, lastAtMost(lines, offset));
    return { line: at + 1, column: offset - /** @type {number} */ (lines[at]) + 1 };
  };
  const position = (/** @type {number} */ offset, /** @type {number} */ b) => ({
    byte: b,
    offset,
    ...lineOf(offset),
  });
  /** From one way of counting to another, through the last wide character before the place. */
  const convert = (
    /** @type {number[]} */ from,
    /** @type {number[] | 1} */ fromSize,
    /** @type {number[]} */ to,
    /** @type {number[] | 1} */ toSize,
    /** @type {number} */ value,
  ) => {
    const k = lastAtMost(from, value);
    if (k < 0) return value;
    const start = /** @type {number} */ (from[k]);
    const size = fromSize === 1 ? 1 : /** @type {number} */ (fromSize[k]);
    // Inside a wide character: its start.
    if (value < start + size) return /** @type {number} */ (to[k]);
    const step = toSize === 1 ? 1 : /** @type {number} */ (toSize[k]);
    return /** @type {number} */ (to[k]) + step + value - start - size;
  };
  const clampByte = (/** @type {number} */ b) => Math.min(Math.max(0, b), total);
  const clampOffset = (/** @type {number} */ o) => Math.min(Math.max(0, o), text.length);

  return {
    bytes: total,
    at(b) {
      const clamped = clampByte(b);
      const offset = convert(bytes, widths, offsets, units, clamped);
      return position(offset, convert(offsets, units, bytes, widths, offset));
    },
    ofOffset(o) {
      const offset = clampOffset(o);
      return position(offset, convert(offsets, units, bytes, widths, offset));
    },
    ofCharacter(c) {
      const offset = clampOffset(convert(chars, 1, offsets, units, Math.max(0, c)));
      return position(offset, convert(offsets, units, bytes, widths, offset));
    },
    byteOf: (o) => convert(offsets, units, bytes, widths, clampOffset(o)),
    characterOf: (o) => convert(offsets, units, chars, 1, clampOffset(o)),
  };
}
