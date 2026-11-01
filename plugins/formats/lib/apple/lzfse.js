// LZFSE, the LZ77 coder with FSE entropy coding of Apple's compression library: the chunks of ULFO
// disk images and decmpfs types 11 and 12. A stream is blocks, each starting with a magic: "bvx-"
// raw bytes, "bvx1" and "bvx2" compressed (tables whole, or packed), "bvxn" LZVN, "bvx$" the end. A
// compressed block holds literal bytes in four interleaved FSE streams and (L, M, D) triplets in a
// fifth, each read backwards from its end. Written after Apple's LZFSE reference implementation
// (lzfse_decode_base.c, lzfse_fse.h), BSD-3-Clause; see NOTICE.
import {
  buildValueTable,
  checkHeader,
  D_STATES,
  headerV1,
  headerV2,
  L_STATES,
  LITERAL_STATES,
  LITERALS_PER_BLOCK,
  literalTable,
  M_STATES,
  u32,
  valueTable,
} from "./fse.js";
import { lzvnInto } from "./lzvn.js";

/** @typedef {import("./fse.js").BlockHeader} BlockHeader */

const END = 0x24787662; // bvx$
const RAW = 0x2d787662; // bvx-
const V1 = 0x31787662; // bvx1
const V2 = 0x32787662; // bvx2
const LZVN = 0x6e787662; // bvxn

/** @param {string} why */
const damaged = (why) => new Error(`The LZFSE stream is damaged: ${why}.`);
const endsEarly = () => new Error("The LZFSE stream ends early.");

// Decoding is synchronous, so one set of tables serves every block.
const LITERALS = new Uint8Array(LITERALS_PER_BLOCK + 64);
const LITERAL_TABLE = new Int32Array(LITERAL_STATES);
const L_TABLE = valueTable(L_STATES);
const M_TABLE = valueTable(M_STATES);
const D_TABLE = valueTable(D_STATES);

/**
 * The block at `at`: its header, where its payload starts and how long it is, and how many bytes
 * it decodes to.
 * @param {Uint8Array} src @param {number} at
 * @returns {{ magic: number, raw: number, payload: number, length: number, header?: BlockHeader }}
 */
function block(src, at) {
  if (at + 4 > src.length) throw endsEarly();
  const magic = u32(src, at);
  if (magic === END) return { magic, raw: 0, payload: at + 4, length: 0 };
  if (magic === RAW) {
    if (at + 8 > src.length) throw endsEarly();
    const raw = u32(src, at + 4);
    return { magic, raw, payload: at + 8, length: raw };
  }
  if (magic === LZVN) {
    if (at + 12 > src.length) throw endsEarly();
    return { magic, raw: u32(src, at + 4), payload: at + 12, length: u32(src, at + 8) };
  }
  if (magic === V1 || magic === V2) {
    const header = magic === V1 ? headerV1(src, at) : headerV2(src, at);
    const length = header.literalPayload + header.lmdPayload;
    return { magic, raw: header.rawBytes, payload: at + header.size, length, header };
  }
  throw damaged("a block has an unknown magic number");
}

/**
 * The four literal streams of a compressed block, decoded into LITERALS.
 * @param {Uint8Array} src @param {number} end where the literal payload ends @param {BlockHeader} h
 */
function literals(src, end, h) {
  literalTable(h.freq, LITERAL_TABLE);
  const table = LITERAL_TABLE;
  let p = end;
  let accum;
  let bits;
  // The stream starts with 3 or 4 bytes from its end; earlier bytes may be read ahead, never used.
  if (h.literalBits) {
    if (p < 4) throw damaged("a literal stream ends early");
    p -= 4;
    accum = u32(src, p);
    bits = h.literalBits + 32;
  } else {
    if (p < 3) throw damaged("a literal stream ends early");
    p -= 3;
    accum = (src[p] ?? 0) | ((src[p + 1] ?? 0) << 8) | ((src[p + 2] ?? 0) << 16);
    bits = 24;
  }
  if (accum >>> bits !== 0) throw damaged("a literal stream does not start cleanly");
  let [s0, s1, s2, s3] = /** @type {[number, number, number, number]} */ (h.literalStates);
  const count = h.literals;
  for (let i = 0; i < count; i += 4) {
    for (let half = 0; half < 2; half++) {
      // Refill to between 24 and 31 bits: two literals take at most 20.
      const take = (31 - bits) & ~7;
      if (take) {
        p -= take >>> 3;
        if (p < 0) throw damaged("a literal stream ends early");
        let incoming = src[p] ?? 0;
        if (take > 8) incoming |= (src[p + 1] ?? 0) << 8;
        if (take > 16) incoming |= (src[p + 2] ?? 0) << 16;
        accum = (accum << take) | incoming;
        bits += take;
      }
      let e = table[half ? s2 : s0] ?? 0;
      bits -= e & 0xff;
      const a = (e >>> 16) + (accum >>> bits);
      accum &= (1 << bits) - 1;
      LITERALS[i + 2 * half] = (e >>> 8) & 0xff;
      e = table[half ? s3 : s1] ?? 0;
      bits -= e & 0xff;
      const b = (e >>> 16) + (accum >>> bits);
      accum &= (1 << bits) - 1;
      LITERALS[i + 2 * half + 1] = (e >>> 8) & 0xff;
      if (half) {
        s2 = a;
        s3 = b;
      } else {
        s0 = a;
        s1 = b;
      }
    }
  }
}

/**
 * Run a compressed block's (L, M, D) triplets: L literals, then M bytes from D back.
 * @param {Uint8Array} src @param {number} start where the triplets' payload starts
 * @param {BlockHeader} h @param {Uint8Array} out @param {number} pos @param {number} limit
 * @param {number} blockEnd where the block's output must end
 * @returns {number} the output position after the block (or at the limit)
 */
function triplets(src, start, h, out, pos, limit, blockEnd) {
  buildValueTable("l", h.freq, L_TABLE);
  buildValueTable("m", h.freq, M_TABLE);
  buildValueTable("d", h.freq, D_TABLE);
  const { info: lInfo, base: lBase } = L_TABLE;
  const { info: mInfo, base: mBase } = M_TABLE;
  const { info: dInfo, base: dBase } = D_TABLE;
  let p = start + h.lmdPayload;
  let accum;
  let bits;
  if (h.lmdBits) {
    if (p - 4 < start) throw damaged("a match stream ends early");
    p -= 4;
    accum = u32(src, p);
    bits = h.lmdBits + 32;
  } else {
    if (p - 3 < start) throw damaged("a match stream ends early");
    p -= 3;
    accum = (src[p] ?? 0) | ((src[p + 1] ?? 0) << 8) | ((src[p + 2] ?? 0) << 16);
    bits = 24;
  }
  if (accum >>> bits !== 0) throw damaged("a match stream does not start cleanly");
  let l = h.lState;
  let m = h.mState;
  let d = h.dState;
  let distance = -1;
  let lit = 0;
  const litEnd = (h.literals + 3) & ~3;
  const stop = Math.min(limit, blockEnd);
  for (let n = h.matches; n > 0; n--) {
    let take;
    let e;
    let v;
    // L, M and D each take at most 23 bits: refill to 24 or more before each.
    take = (31 - bits) & ~7;
    if (take) {
      p -= take >>> 3;
      if (p < start) throw damaged("a match stream ends early");
      v = src[p] ?? 0;
      if (take > 8) v |= (src[p + 1] ?? 0) << 8;
      if (take > 16) v |= (src[p + 2] ?? 0) << 16;
      accum = (accum << take) | v;
      bits += take;
    }
    e = lInfo[l] ?? 0;
    bits -= e & 0xff;
    v = accum >>> bits;
    accum &= (1 << bits) - 1;
    const literal = (lBase[l] ?? 0) + (v & ((1 << ((e >>> 8) & 0xff)) - 1));
    l = (e >>> 16) + (v >>> ((e >>> 8) & 0xff));
    take = (31 - bits) & ~7;
    if (take) {
      p -= take >>> 3;
      if (p < start) throw damaged("a match stream ends early");
      v = src[p] ?? 0;
      if (take > 8) v |= (src[p + 1] ?? 0) << 8;
      if (take > 16) v |= (src[p + 2] ?? 0) << 16;
      accum = (accum << take) | v;
      bits += take;
    }
    e = mInfo[m] ?? 0;
    bits -= e & 0xff;
    v = accum >>> bits;
    accum &= (1 << bits) - 1;
    const match = (mBase[m] ?? 0) + (v & ((1 << ((e >>> 8) & 0xff)) - 1));
    m = (e >>> 16) + (v >>> ((e >>> 8) & 0xff));
    take = (31 - bits) & ~7;
    if (take) {
      p -= take >>> 3;
      if (p < start) throw damaged("a match stream ends early");
      v = src[p] ?? 0;
      if (take > 8) v |= (src[p + 1] ?? 0) << 8;
      if (take > 16) v |= (src[p + 2] ?? 0) << 16;
      accum = (accum << take) | v;
      bits += take;
    }
    e = dInfo[d] ?? 0;
    bits -= e & 0xff;
    v = accum >>> bits;
    accum &= (1 << bits) - 1;
    const next = (dBase[d] ?? 0) + (v & ((1 << ((e >>> 8) & 0xff)) - 1));
    d = (e >>> 16) + (v >>> ((e >>> 8) & 0xff));
    if (next) distance = next;

    if (lit + literal > litEnd) throw damaged("a block uses more literals than it has");
    if (distance < 0 || distance > pos + literal) throw damaged("a match reaches before the start");
    if (pos + literal + match > stop) {
      if (stop === blockEnd && blockEnd <= limit)
        throw damaged("a block decodes to more bytes than its header says");
      // The caller's limit: copy what fits, then stop.
      const first = Math.min(literal, stop - pos);
      out.set(LITERALS.subarray(lit, lit + first), pos);
      pos += first;
      for (; pos < stop; pos++) out[pos] = out[pos - distance] ?? 0;
      return pos;
    }
    if (literal < 16) for (let k = 0; k < literal; k++) out[pos + k] = LITERALS[lit + k] ?? 0;
    else out.set(LITERALS.subarray(lit, lit + literal), pos);
    pos += literal;
    lit += literal;
    const from = pos - distance;
    if (distance < match || match < 16)
      for (let k = 0; k < match; k++) out[pos + k] = out[from + k] ?? 0;
    else out.copyWithin(pos, from, from + match);
    pos += match;
  }
  return pos;
}

const NAMES = /** @type {Record<number, string>} */ ({
  [END]: "bvx$",
  [RAW]: "bvx-",
  [V1]: "bvx1",
  [V2]: "bvx2",
  [LZVN]: "bvxn",
});

/**
 * The stream's blocks as they are laid out, the end marker last: for tests and diagnostics.
 * @param {Uint8Array} input
 * @returns {{ magic: string, at: number, payload: number, length: number, raw: number, header?: BlockHeader }[]}
 */
export function lzfseBlocks(input) {
  const found = [];
  for (let at = 0; ; ) {
    const b = block(input, at);
    found.push({ ...b, magic: NAMES[b.magic] ?? "", at });
    if (b.magic === END) return found;
    if (b.payload + b.length > input.length) throw endsEarly();
    at = b.payload + b.length;
  }
}

/**
 * Decode an LZFSE stream: blocks bvx- (raw), bvx1 (v1 tables), bvx2 (v2 packed tables), bvxn (LZVN)
 * until bvx$.
 * @param {Uint8Array} input
 * @param {number} [expected] the decoded size when known: the output is sized once and decoding
 * stops there (it answers fewer bytes when the stream holds fewer)
 * @returns {Uint8Array}
 */
export function decodeLzfse(input, expected = 0) {
  // First pass: the blocks' sizes, so the output is allocated once.
  let total = 0;
  for (let at = 0; !(expected > 0 && total >= expected); ) {
    const b = block(input, at);
    if (b.magic === END) break;
    if (b.payload + b.length > input.length) throw endsEarly();
    total += b.raw;
    at = b.payload + b.length;
  }
  const limit = expected > 0 ? expected : total;
  const out = new Uint8Array(limit);
  let pos = 0;
  for (let at = 0; pos < limit; ) {
    const b = block(input, at);
    if (b.magic === END) break;
    const blockEnd = pos + b.raw;
    if (b.magic === RAW) {
      const take = Math.min(b.raw, limit - pos);
      out.set(input.subarray(b.payload, b.payload + take), pos);
      pos += take;
    } else if (b.magic === LZVN) {
      const sink = { out, pos, limit: Math.min(limit, blockEnd), at: 0, ended: false };
      lzvnInto(input, b.payload, b.payload + b.length, sink, "LZFSE");
      const whole = blockEnd <= limit;
      if (whole && (sink.pos !== blockEnd || !sink.ended || sink.at !== b.payload + b.length))
        throw damaged("an LZVN block decodes to the wrong size");
      pos = sink.pos;
    } else {
      const h = /** @type {BlockHeader} */ (b.header);
      checkHeader(h);
      literals(input, b.payload + h.literalPayload, h);
      pos = triplets(input, b.payload + h.literalPayload, h, out, pos, limit, blockEnd);
      if (blockEnd <= limit && pos !== blockEnd)
        throw damaged("a block decodes to fewer bytes than its header says");
    }
    at = b.payload + b.length;
  }
  return pos === out.length ? out : out.subarray(0, pos);
}
