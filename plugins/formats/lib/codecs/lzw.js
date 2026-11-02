// Unix compress (.Z): LZW codes of 9 to 16 bits, least significant bit first, in groups of eight
// codes; a change of width or a CLEAR code skips the rest of its group, as ncompress reads them.
import { damaged, endsEarly } from "./input.js";

/** @typedef {import("./input.js").Input} Input */

const CODEC = "compress";
const CLEAR = 256;
const OUT = 64 * 1024;

/** @param {Input} input @returns {AsyncGenerator<Uint8Array>} */
export async function* uncompress(input) {
  input.ends = () => endsEarly(CODEC);
  const head = await input.read(3);
  if (head[0] !== 0x1f || head[1] !== 0x9d) throw damaged(CODEC, "it does not start with 1F 9D");
  const flags = /** @type {number} */ (head[2]);
  const maxBits = flags & 0x1f;
  const blockMode = (flags & 0x80) !== 0;
  if (maxBits < 9 || maxBits > 16) throw damaged(CODEC, "the code width is out of range");
  const maxMax = 1 << maxBits;
  const prefix = new Uint16Array(maxMax);
  const suffix = new Uint8Array(maxMax);
  for (let i = 0; i < 256; i++) suffix[i] = i;
  const stack = new Uint8Array(maxMax);
  let bits = 9;
  let maxCode = (1 << bits) - 1;
  let free = blockMode ? 257 : 256;
  let old = -1;
  let last = 0;
  // `pos` counts bits from input.pos, which stays on a group boundary of the current width.
  let pos = 0;
  let out = new Uint8Array(OUT);
  let o = 0;
  /** Move on to the next group boundary, where the next width (or a fresh table) starts. */
  const regroup = () => {
    const group = bits * 8;
    pos = Math.ceil(pos / group) * group;
    input.pos += pos >> 3;
    pos = 0;
  };
  for (;;) {
    // Keep 64 KiB ahead; the codes below never read past what is buffered.
    await input.need(65536);
    const available = (input.buf.length - input.pos) * 8;
    if (available - pos < bits) break;
    while (available - pos >= bits) {
      if (free > maxCode && bits < maxBits) {
        regroup();
        bits++;
        maxCode = bits === maxBits ? maxMax : (1 << bits) - 1;
        break;
      }
      const at = input.pos + (pos >> 3);
      const buf = input.buf;
      const word =
        /** @type {number} */ (buf[at]) | ((buf[at + 1] ?? 0) << 8) | ((buf[at + 2] ?? 0) << 16);
      const code = (word >>> (pos & 7)) & ((1 << bits) - 1);
      pos += bits;
      if (old === -1) {
        if (code >= 256) throw damaged(CODEC, "the first code is not a byte");
        old = last = code;
        out[o++] = code;
        continue;
      }
      if (code === CLEAR && blockMode) {
        prefix.fill(0);
        free = 256;
        regroup();
        bits = 9;
        maxCode = (1 << bits) - 1;
        break;
      }
      let c = code;
      let top = 0;
      if (c >= free) {
        if (c > free) throw damaged(CODEC, "a code points past the table");
        stack[top++] = last;
        c = old;
      }
      while (c >= 256) {
        stack[top++] = /** @type {number} */ (suffix[c]);
        c = /** @type {number} */ (prefix[c]);
      }
      last = /** @type {number} */ (suffix[c]);
      stack[top++] = last;
      if (o + top > OUT) {
        yield out.slice(0, o);
        out = new Uint8Array(Math.max(OUT, top));
        o = 0;
      }
      while (top > 0) out[o++] = /** @type {number} */ (stack[--top]);
      if (free < maxMax) {
        prefix[free] = old;
        suffix[free] = last;
        free++;
      }
      old = code;
      // Hand whole groups back to the input, so it can drop what is read.
      if (pos >= bits * 8 * 512 && pos % (bits * 8) === 0) {
        input.pos += pos >> 3;
        pos = 0;
        break;
      }
    }
    if (o >= OUT / 2) {
      yield out.slice(0, o);
      o = 0;
    }
  }
  if (o) yield out.slice(0, o);
}
