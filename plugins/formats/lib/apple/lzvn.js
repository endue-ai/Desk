// LZVN, the byte-oriented LZ77 coder of Apple's compression library: the raw streams of decmpfs
// types 7 and 8, and the "bvxn" blocks of LZFSE. Each opcode carries a literal length L, a match
// length M and a match distance D (or reuses the previous D). Written after Apple's LZFSE
// reference implementation (lzvn_decode_base.c), BSD-3-Clause; see NOTICE.

const UNDEFINED = 0;
const SMALL_DISTANCE = 1;
const MEDIUM_DISTANCE = 2;
const LARGE_DISTANCE = 3;
const PREVIOUS_DISTANCE = 4;
const SMALL_MATCH = 5;
const LARGE_MATCH = 6;
const SMALL_LITERAL = 7;
const LARGE_LITERAL = 8;
const NOTHING = 9;
const END = 10;

/** What each opcode does, as the reference's opcode table lays it out. */
const KIND = (() => {
  const kinds = new Uint8Array(256);
  for (let op = 0; op < 256; op++) {
    let kind = SMALL_DISTANCE;
    if (op >= 0xf0) kind = op === 0xf0 ? LARGE_MATCH : SMALL_MATCH;
    else if (op >= 0xe0) kind = op === 0xe0 ? LARGE_LITERAL : SMALL_LITERAL;
    else if (op >= 0xd0 || (op >= 0x70 && op < 0x80)) kind = UNDEFINED;
    else if (op >= 0xa0 && op < 0xc0) kind = MEDIUM_DISTANCE;
    else if ((op & 7) === 7) kind = LARGE_DISTANCE;
    else if ((op & 7) === 6) {
      if (op === 6) kind = END;
      else if (op === 14 || op === 22) kind = NOTHING;
      else kind = op < 0x40 ? UNDEFINED : PREVIOUS_DISTANCE;
    }
    kinds[op] = kind;
  }
  return kinds;
})();

/**
 * Where decoded bytes go: `out` from `pos` up to `limit` (Infinity: `out` grows as needed). After
 * a run, `pos` is where decoding stopped, `at` the next input byte, and `ended` whether the
 * end-of-stream opcode was read.
 * @typedef {{ out: Uint8Array, pos: number, limit: number, at: number, ended: boolean }} Sink
 */

/** @param {string} name */
const endsEarly = (name) => new Error(`The ${name} stream ends early.`);
/** @param {string} name @param {string} why */
const damaged = (name, why) => new Error(`The ${name} stream is damaged: ${why}.`);

/** @param {Sink} sink @param {number} need the size `out` must reach */
function grow(sink, need) {
  const bigger = new Uint8Array(Math.max(need, sink.out.length * 2, 4096));
  bigger.set(sink.out.subarray(0, sink.pos));
  sink.out = bigger;
}

/**
 * Decode LZVN from `src[at..end)` into the sink until the end-of-stream opcode, the end of the
 * input, or the sink's limit. Matches may reach back to the start of `out`.
 * @param {Uint8Array} src @param {number} at @param {number} end @param {Sink} sink
 * @param {string} [name] the stream's name in errors ("LZVN", or "LZFSE" inside a bvxn block)
 */
export function lzvnInto(src, at, end, sink, name = "LZVN") {
  let out = sink.out;
  let pos = sink.pos;
  const limit = sink.limit;
  let i = at;
  let d = 0;
  sink.ended = false;
  while (i < end) {
    const op = src[i] ?? 0;
    const kind = KIND[op];
    // At the limit, only the opcodes that write nothing are still read: the end of the stream.
    if (pos >= limit && kind !== END && kind !== NOTHING) break;
    let literal = 0;
    let match = 0;
    let size = 1;
    switch (kind) {
      case SMALL_DISTANCE:
        size = 2;
        if (i + 2 > end) throw endsEarly(name);
        literal = op >>> 6;
        match = ((op >>> 3) & 7) + 3;
        d = ((op & 7) << 8) | (src[i + 1] ?? 0);
        break;
      case MEDIUM_DISTANCE: {
        size = 3;
        if (i + 3 > end) throw endsEarly(name);
        const word = (src[i + 1] ?? 0) | ((src[i + 2] ?? 0) << 8);
        literal = (op >>> 3) & 3;
        match = (((op & 7) << 2) | (word & 3)) + 3;
        d = word >>> 2;
        break;
      }
      case LARGE_DISTANCE:
        size = 3;
        if (i + 3 > end) throw endsEarly(name);
        literal = op >>> 6;
        match = ((op >>> 3) & 7) + 3;
        d = (src[i + 1] ?? 0) | ((src[i + 2] ?? 0) << 8);
        break;
      case PREVIOUS_DISTANCE:
        literal = op >>> 6;
        match = ((op >>> 3) & 7) + 3;
        break;
      case SMALL_MATCH:
        match = op & 15;
        break;
      case LARGE_MATCH:
        size = 2;
        if (i + 2 > end) throw endsEarly(name);
        match = (src[i + 1] ?? 0) + 16;
        break;
      case SMALL_LITERAL:
        literal = op & 15;
        break;
      case LARGE_LITERAL:
        size = 2;
        if (i + 2 > end) throw endsEarly(name);
        literal = (src[i + 1] ?? 0) + 16;
        break;
      case NOTHING:
        i++;
        continue;
      case END:
        if (i + 8 > end) throw endsEarly(name);
        sink.ended = true;
        sink.out = out;
        sink.pos = pos;
        sink.at = i + 8;
        return;
      default:
        throw damaged(name, `opcode 0x${op.toString(16)} is not defined`);
    }
    i += size;
    if (literal + match > limit - pos) {
      // The last bytes asked for: copy what fits below the limit, then stop.
      if (i + literal > end) throw endsEarly(name);
      const take = Math.min(literal, limit - pos);
      out.set(src.subarray(i, i + take), pos);
      pos += take;
      i += take;
      if (pos < limit) {
        if (d === 0 || d > pos) throw damaged(name, "a match reaches before the start");
        for (; pos < limit; pos++) out[pos] = out[pos - d] ?? 0;
      }
      break;
    }
    if (pos + literal + match > out.length) {
      sink.pos = pos;
      grow(sink, pos + literal + match);
      out = sink.out;
    }
    if (literal) {
      if (i + literal > end) throw endsEarly(name);
      if (literal < 16) for (let k = 0; k < literal; k++) out[pos + k] = src[i + k] ?? 0;
      else out.set(src.subarray(i, i + literal), pos);
      pos += literal;
      i += literal;
    }
    if (match) {
      if (d === 0 || d > pos) throw damaged(name, "a match reaches before the start");
      const from = pos - d;
      if (d < match || match < 16)
        for (let k = 0; k < match; k++) out[pos + k] = out[from + k] ?? 0;
      else out.copyWithin(pos, from, from + match);
      pos += match;
    }
  }
  sink.out = out;
  sink.pos = pos;
  sink.at = i;
}

/**
 * Decode a raw LZVN stream (no block header), ending at the end-of-stream opcode (0x06 followed by
 * its 7 zero bytes) or at the end of the input.
 * @param {Uint8Array} input
 * @param {number} [expected] the decoded size when known: the output is sized once and decoding
 * stops there
 * @returns {Uint8Array}
 */
export function decodeLzvn(input, expected = 0) {
  /** @type {Sink} */
  const sink = {
    out: new Uint8Array(expected > 0 ? expected : Math.max(4096, input.length * 3)),
    pos: 0,
    limit: expected > 0 ? expected : Number.POSITIVE_INFINITY,
    at: 0,
    ended: false,
  };
  lzvnInto(input, 0, input.length, sink);
  return sink.out.subarray(0, sink.pos);
}
