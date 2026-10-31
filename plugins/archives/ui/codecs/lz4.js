// LZ4 frames (and the legacy format): blocks of literal runs and matches into the last 64 KiB,
// linked or independent, with XXH32 header, block and content checksums.
import { u32 } from "../bytes.js";
import { damaged, endsEarly } from "./input.js";
import { Xxh32, xxh32 } from "./xxh32.js";

/** @typedef {import("./input.js").Input} Input */

const CODEC = "LZ4";
const HISTORY = 64 * 1024;
const SIZES = [0, 0, 0, 0, 64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024];

/**
 * Decode one block into `out` from `at`, matches reaching back into what is already there.
 * @param {Uint8Array} src @param {Uint8Array} out @param {number} at
 * @returns {number} where the block's output ends
 */
function block(src, out, at) {
  let s = 0;
  let o = at;
  const end = src.length;
  for (;;) {
    if (s >= end) throw damaged(CODEC, "a block ends inside a sequence");
    const token = /** @type {number} */ (src[s++]);
    let literals = token >>> 4;
    if (literals === 15) {
      let b = 255;
      while (b === 255) {
        if (s >= end) throw damaged(CODEC, "a literal length runs past the block");
        b = /** @type {number} */ (src[s++]);
        literals += b;
      }
    }
    if (s + literals > end || o + literals > out.length)
      throw damaged(CODEC, "literals run past the block");
    out.set(src.subarray(s, s + literals), o);
    s += literals;
    o += literals;
    if (s === end) return o;
    if (s + 2 > end) throw damaged(CODEC, "a match offset is cut off");
    const offset = /** @type {number} */ (src[s]) | /** @type {number} */ (src[s + 1] << 8);
    s += 2;
    if (offset === 0 || offset > o) throw damaged(CODEC, "a match reaches back before the data");
    let length = (token & 15) + 4;
    if ((token & 15) === 15) {
      let b = 255;
      while (b === 255) {
        if (s >= end) throw damaged(CODEC, "a match length runs past the block");
        b = /** @type {number} */ (src[s++]);
        length += b;
      }
    }
    if (o + length > out.length) throw damaged(CODEC, "a block is larger than its frame allows");
    let from = o - offset;
    if (offset >= length) {
      out.copyWithin(o, from, from + length);
      o += length;
    } else for (let k = 0; k < length; k++) out[o++] = /** @type {number} */ (out[from++]);
  }
}

/** One frame after its magic. @param {Input} input @returns {AsyncGenerator<Uint8Array>} */
async function* frame(input) {
  const descriptor = await input.read(2);
  const flags = /** @type {number} */ (descriptor[0]);
  const bd = /** @type {number} */ (descriptor[1]);
  if (flags >>> 6 !== 1) throw damaged(CODEC, "the frame version is not 1");
  const linked = !(flags & 0x20);
  const blockSums = !!(flags & 0x10);
  const sized = !!(flags & 8);
  const summed = !!(flags & 4);
  if (flags & 1) throw damaged(CODEC, "frames with a dictionary are not supported");
  const max = SIZES[(bd >>> 4) & 7] ?? 0;
  if (!max) throw damaged(CODEC, "the block size is out of range");
  const rest = await input.read(sized ? 9 : 1);
  const check = xxh32(Uint8Array.from([...descriptor, ...rest.subarray(0, rest.length - 1)]));
  if (((check >>> 8) & 0xff) !== rest[rest.length - 1])
    throw damaged(CODEC, "the frame header's checksum does not match");
  const content = summed ? new Xxh32() : undefined;
  const out = new Uint8Array(HISTORY + max);
  let kept = 0;
  for (;;) {
    const word = u32(await input.read(4), 0);
    if (word === 0) break;
    const raw = (word & 0x80000000) !== 0;
    const size = word & 0x7fffffff;
    if (size > max) throw damaged(CODEC, "a block is larger than its frame allows");
    const data = await input.read(size);
    if (blockSums && u32(await input.read(4), 0) !== xxh32(data))
      throw damaged(CODEC, "a block's checksum does not match");
    const start = linked ? kept : 0;
    if (!linked) kept = 0;
    let end;
    if (raw) {
      out.set(data, start);
      end = start + size;
    } else end = block(data, out, start);
    const decoded = out.slice(start, end);
    content?.update(decoded);
    if (decoded.length) yield decoded;
    if (linked) {
      kept = Math.min(end, HISTORY);
      out.copyWithin(0, end - kept, end);
    }
  }
  if (content && u32(await input.read(4), 0) !== content.digest())
    throw damaged(CODEC, "the content checksum does not match");
}

/** The legacy format: independent blocks of up to 8 MiB, to the end of the input. @param {Input} input */
async function* legacy(input) {
  const out = new Uint8Array(8 * 1024 * 1024);
  while (await input.need(4)) {
    const size = u32(input.buf, input.pos);
    if (size === 0x184c2102 || size === 0x184d2204) return;
    input.pos += 4;
    if (size > 8 * 1024 * 1024 + 65536) throw damaged(CODEC, "a block is too large");
    const end = block(await input.read(size), out, 0);
    yield out.slice(0, end);
  }
}

/** @param {Input} input @returns {AsyncGenerator<Uint8Array>} */
export async function* unlz4(input) {
  input.ends = () => endsEarly(CODEC);
  for (let frames = 0; ; frames++) {
    if (!(await input.need(4))) {
      if (frames === 0) throw endsEarly(CODEC);
      return;
    }
    const magic = u32(await input.read(4), 0);
    if (magic === 0x184d2204) yield* frame(input);
    else if (magic === 0x184c2102) yield* legacy(input);
    else if (magic >>> 4 === 0x184d2a5) await input.skip(u32(await input.read(4), 0));
    else
      throw damaged(
        CODEC,
        frames ? "unknown data follows a frame" : "it does not start with a frame",
      );
  }
}
