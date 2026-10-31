// Filters that undo what an encoder did before compressing: x86 BCJ (relative CALL and JMP targets
// made absolute again) and Delta. Both work on decoded chunks and carry state across them.
import { concat } from "../../bytes.js";

const ALLOWED = [true, true, true, false, true, false, false, false];
const BIT = [0, 1, 2, 2, 3, 3, 3, 3];
const msByte = (/** @type {number} */ b) => b === 0 || b === 0xff;

/**
 * Convert in place what can be converted; returns how many bytes are done (the last four wait for
 * more input). As xz's simple/x86.c.
 * @param {{ mask: number, prev: number }} s @param {number} now @param {Uint8Array} buf
 */
function x86(s, now, buf) {
  if (buf.length < 5) return 0;
  let mask = s.mask;
  let prev = s.prev;
  if ((now - prev) >>> 0 > 5) prev = (now - 5) >>> 0;
  const limit = buf.length - 5;
  let i = 0;
  while (i <= limit) {
    let b = /** @type {number} */ (buf[i]);
    if (b !== 0xe8 && b !== 0xe9) {
      i++;
      continue;
    }
    const offset = (now + i - prev) >>> 0;
    prev = (now + i) >>> 0;
    if (offset > 5) mask = 0;
    else for (let k = 0; k < offset; k++) mask = (mask & 0x77) << 1;
    b = /** @type {number} */ (buf[i + 4]);
    if (msByte(b) && ALLOWED[(mask >>> 1) & 7] && mask >>> 1 < 0x10) {
      let src =
        ((b << 24) | ((buf[i + 3] ?? 0) << 16) | ((buf[i + 2] ?? 0) << 8) | (buf[i + 1] ?? 0)) >>>
        0;
      let dest = 0;
      for (;;) {
        dest = (src - ((now + i + 5) >>> 0)) >>> 0;
        if (mask === 0) break;
        const n = /** @type {number} */ (BIT[mask >>> 1]);
        b = (dest >>> (24 - n * 8)) & 0xff;
        if (!msByte(b)) break;
        src = (dest ^ (2 ** (32 - n * 8) - 1)) >>> 0;
      }
      buf[i + 4] = ~(((dest >>> 24) & 1) - 1) & 0xff;
      buf[i + 3] = (dest >>> 16) & 0xff;
      buf[i + 2] = (dest >>> 8) & 0xff;
      buf[i + 1] = dest & 0xff;
      i += 5;
      mask = 0;
    } else {
      i++;
      mask |= 1;
      if (msByte(b)) mask |= 0x10;
    }
  }
  s.mask = mask;
  s.prev = prev;
  return i;
}

/**
 * The x86 BCJ decoder over decoded chunks; `start` is the position of the first byte (xz's start
 * offset property, 0 otherwise).
 * @param {AsyncIterable<Uint8Array>} chunks @param {number} [start]
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* bcjX86(chunks, start = 0) {
  const state = { mask: 0, prev: (start - 5) >>> 0 };
  let now = start >>> 0;
  let held = new Uint8Array(0);
  for await (const chunk of chunks) {
    const buf = held.length ? concat([held, chunk]) : chunk.slice();
    const done = x86(state, now, buf);
    now = (now + done) >>> 0;
    if (done) yield buf.subarray(0, done);
    held = buf.subarray(done);
  }
  if (held.length) yield held;
}

/**
 * The Delta decoder: each byte adds the decoded byte `distance` before it.
 * @param {AsyncIterable<Uint8Array>} chunks @param {number} distance 1 to 256
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* deltaDecode(chunks, distance) {
  const history = new Uint8Array(256);
  let pos = 0;
  for await (const chunk of chunks) {
    const out = chunk.slice();
    for (let i = 0; i < out.length; i++) {
      const byte = ((out[i] ?? 0) + (history[(pos - distance) & 0xff] ?? 0)) & 0xff;
      out[i] = byte;
      history[pos & 0xff] = byte;
      pos++;
    }
    yield out;
  }
}
