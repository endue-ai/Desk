// Zstandard (RFC 8878): frames one after another, skippable frames passed over, raw, RLE and
// compressed blocks, a window that grows as the content does (never past the frame's window), and
// the XXH64 content checksum. Decoded output is yielded block by block.
import { damaged, endsEarly } from "../input.js";
import { readLiterals } from "./huffman.js";
import { runSequences } from "./sequences.js";
import { Xxh64 } from "./xxh64.js";

/** @typedef {import("../input.js").Input} Input */
/** @typedef {import("./sequences.js").SequencesState & import("./huffman.js").LiteralsState} FrameState */

const MAGIC = 0xfd2fb528;
const BLOCK_MAX = 128 * 1024;
/** The largest window decoded: the zstd command line asks for --memory past 128 MiB, we allow 2 GiB. */
const WINDOW_MAX = 2 ** 31;

/** @param {Uint8Array} b @param {number} o */
const u32 = (b, o) =>
  /** @type {number} */ (
    b[o] |
      /** @type {number} */ (b[o + 1] << 8) |
      /** @type {number} */ (b[o + 2] << 16) |
      /** @type {number} */ (b[o + 3] << 24)
  ) >>> 0;

/** Make room for `need` more bytes after state.len, keeping `keep` bytes of history. */
function room(
  /** @type {FrameState} */ state,
  /** @type {number} */ need,
  /** @type {number} */ keep,
  /** @type {number} */ cap,
) {
  if (state.len + need <= state.out.length) return;
  if (state.out.length < cap) {
    const size = Math.min(cap, Math.max(state.out.length * 2, state.len + need));
    const grown = new Uint8Array(size);
    grown.set(state.out.subarray(0, state.len));
    state.out = grown;
    if (state.len + need <= size) return;
  }
  const kept = Math.min(state.len, keep);
  state.out.copyWithin(0, state.len - kept, state.len);
  state.len = kept;
}

/** @param {Input} input @param {number} n */
async function bytes(input, n) {
  if (!(await input.need(n))) throw endsEarly("Zstandard");
  return input.take(n);
}

/**
 * One frame, after its magic number.
 * @param {Input} input
 * @returns {AsyncGenerator<Uint8Array>}
 */
async function* frame(input) {
  const fhd = /** @type {number} */ ((await bytes(input, 1))[0]);
  if (fhd & 8) throw damaged("Zstandard", "a reserved bit is set in a frame header");
  const single = (fhd >> 5) & 1;
  const fcsBytes = fhd >> 6 ? /** @type {number[]} */ ([0, 2, 4, 8][fhd >> 6] ?? 0) : single;
  const dictBytes = /** @type {number} */ ([0, 1, 2, 4][fhd & 3]);
  const head = await bytes(input, (single ? 0 : 1) + dictBytes + fcsBytes);
  let at = 0;
  let window = 0;
  if (!single) {
    const wd = /** @type {number} */ (head[at++]);
    const base = 2 ** (10 + (wd >> 3));
    window = base + (base / 8) * (wd & 7);
  }
  let dictionary = 0;
  for (let i = 0; i < dictBytes; i++) dictionary += /** @type {number} */ (head[at++]) * 256 ** i;
  if (dictionary !== 0)
    throw new Error(`The Zstandard frame needs dictionary ${dictionary}, which is not available.`);
  let fcs = -1;
  if (fcsBytes) {
    fcs = 0;
    for (let i = 0; i < fcsBytes; i++) fcs += /** @type {number} */ (head[at++]) * 256 ** i;
    if (fcsBytes === 2) fcs += 256;
  }
  if (single) window = fcs;
  if (window > WINDOW_MAX) throw damaged("Zstandard", "its window is larger than 2 GiB");
  const keep = fcs >= 0 ? Math.min(window, fcs) : window;
  const blockMax = Math.min(window, BLOCK_MAX);
  const cap = keep + 2 * BLOCK_MAX;
  /** @type {FrameState} */
  const state = {
    out: new Uint8Array(Math.min(cap, 256 * 1024)),
    len: 0,
    window,
    rep: [1, 4, 8],
    tables: {},
    huffman: null,
  };
  const lit = new Uint8Array(BLOCK_MAX);
  const hash = fhd & 4 ? new Xxh64() : null;
  let total = 0;
  for (;;) {
    const header = await bytes(input, 3);
    const h =
      /** @type {number} */ (header[0]) |
      /** @type {number} */ (header[1] << 8) |
      /** @type {number} */ (header[2] << 16);
    const last = h & 1;
    const type = (h >> 1) & 3;
    const size = h >>> 3;
    if (type === 3) throw damaged("Zstandard", "a block has the reserved type");
    if (size > blockMax) throw damaged("Zstandard", "a block is larger than the frame allows");
    room(state, type === 2 ? blockMax : size, keep, cap);
    const start = state.len;
    if (type === 0) {
      state.out.set(await bytes(input, size), start);
      state.len += size;
    } else if (type === 1) {
      state.out.fill(/** @type {number} */ ((await bytes(input, 1))[0]), start, start + size);
      state.len += size;
    } else {
      const block = await bytes(input, size);
      const { count, used } = readLiterals(block, 0, size, lit, state);
      runSequences(block, used, size, state, lit, count);
      if (state.len - start > blockMax)
        throw damaged("Zstandard", "a block decodes past its limit");
    }
    const produced = state.out.subarray(start, state.len);
    total += produced.length;
    if (fcs >= 0 && total > fcs) throw damaged("Zstandard", "it holds more than its frame says");
    hash?.update(produced);
    if (produced.length) yield produced.slice();
    if (last) break;
  }
  if (fcs >= 0 && total !== fcs) throw damaged("Zstandard", "it holds less than its frame says");
  if (hash) {
    const stored = u32(await bytes(input, 4), 0);
    if (stored !== hash.low32()) throw damaged("Zstandard", "the content checksum does not match");
  }
}

/**
 * Every frame in `input`, decoded.
 * @param {Input} input @param {unknown} [options]
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* unzstd(input, options) {
  void options;
  let frames = 0;
  for (;;) {
    if (!(await input.need(4))) {
      if (frames === 0 || input.available > 0) throw endsEarly("Zstandard");
      return;
    }
    const magic = u32(input.buf, input.pos);
    input.take(4);
    if (magic >>> 4 === 0x184d2a5) {
      const size = u32(await bytes(input, 4), 0);
      await input.skip(size).catch(() => {
        throw endsEarly("Zstandard");
      });
    } else if (magic === MAGIC) {
      yield* frame(input);
    } else {
      throw damaged(
        "Zstandard",
        frames ? "unknown data follows a frame" : "it does not start with a frame",
      );
    }
    frames++;
  }
}
