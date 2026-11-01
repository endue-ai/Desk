// BZZ, DjVu's general-purpose compressor (DjVu v3 specification, appendix 4): a Burrows-Wheeler
// transform whose move-to-front numbers are coded with the Z'-coder. DIRM, NAVM, ANTz, TXTz and
// FGbz data are BZZ streams.

import { ZPDecoder } from "./zp.js";

const LARGEST_BLOCK = 4 << 20;
/** Bytes the Z'-coder may read ahead past the end of a whole stream. */
const SLACK = 8;

/**
 * Decodes a whole BZZ stream: blocks until one says its size is 0.
 * @param {Uint8Array} bytes @param {number} [limit] stop once this many bytes are out
 * @returns {Uint8Array}
 */
export function bzz(bytes, limit = Number.POSITIVE_INFINITY) {
  const zp = new ZPDecoder(bytes);
  const contexts = new Uint8Array(262);
  /** @type {Uint8Array[]} */
  const parts = [];
  let total = 0;
  for (;;) {
    const block = decodeBlock(zp, contexts);
    if (zp.past > SLACK) throw new Error("The BZZ data is cut short.");
    if (!block) break;
    parts.push(block);
    total += block.length;
    if (total >= limit) break;
  }
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A b-bit number read in pass-through mode. @param {ZPDecoder} zp @param {number} bits */
function raw(zp, bits) {
  let n = 1;
  const top = 1 << bits;
  while (n < top) n = (n << 1) | zp.passthrough();
  return n - top;
}

/**
 * A b-bit number from the binary tree of contexts starting at `offset`.
 * @param {ZPDecoder} zp @param {Uint8Array} contexts @param {number} offset @param {number} bits
 */
function tree(zp, contexts, offset, bits) {
  let n = 1;
  const top = 1 << bits;
  while (n < top) n = (n << 1) | zp.decode(contexts, offset + n - 1);
  return n - top;
}

/**
 * One block: its size, its estimation speed, its move-to-front numbers, then the inverse
 * Burrows-Wheeler transform. Null at the end of the stream.
 * @param {ZPDecoder} zp @param {Uint8Array} contexts
 */
function decodeBlock(zp, contexts) {
  const size = raw(zp, 24);
  if (size === 0) return null;
  if (size > LARGEST_BLOCK) throw new Error("A BZZ block is larger than the format allows.");
  let shift = 0;
  if (zp.passthrough()) shift = zp.passthrough() ? 2 : 1;

  const mtf = new Uint8Array(256);
  for (let i = 0; i < 256; i++) mtf[i] = i;
  const freq = new Uint32Array(4);
  const data = new Uint8Array(size);
  let fadd = 4;
  let mtfno = 3;
  let marker = -1;
  for (let i = 0; i < size; i++) {
    const ctx = mtfno <= 1 ? mtfno : 2;
    if (zp.decode(contexts, ctx)) mtfno = 0;
    else if (zp.decode(contexts, ctx + 3)) mtfno = 1;
    else if (zp.decode(contexts, 6)) mtfno = 2 + tree(zp, contexts, 7, 1);
    else if (zp.decode(contexts, 8)) mtfno = 4 + tree(zp, contexts, 9, 2);
    else if (zp.decode(contexts, 12)) mtfno = 8 + tree(zp, contexts, 13, 3);
    else if (zp.decode(contexts, 20)) mtfno = 16 + tree(zp, contexts, 21, 4);
    else if (zp.decode(contexts, 36)) mtfno = 32 + tree(zp, contexts, 37, 5);
    else if (zp.decode(contexts, 68)) mtfno = 64 + tree(zp, contexts, 69, 6);
    else if (zp.decode(contexts, 132)) mtfno = 128 + tree(zp, contexts, 133, 7);
    else {
      mtfno = 256;
      data[i] = 0;
      if (marker >= 0) throw new Error("A BZZ block has two end markers.");
      marker = i;
      continue;
    }
    const symbol = mtf[mtfno];
    data[i] = symbol;
    // Rotate the symbol to the front part of the table, keeping freq[0..3] sorted.
    fadd += fadd >>> shift;
    if (fadd > 0x10000000) {
      fadd >>>= 24;
      for (let j = 0; j < 4; j++) freq[j] >>>= 24;
    }
    let fc = fadd;
    if (mtfno < 4) fc += freq[mtfno];
    let k = mtfno;
    for (; k > 3; k--) mtf[k] = mtf[k - 1];
    for (; k > 0 && fc >= freq[k - 1]; k--) {
      mtf[k] = mtf[k - 1];
      freq[k] = freq[k - 1];
    }
    mtf[k] = symbol;
    freq[k] = fc;
  }
  if (marker <= 0 || marker >= size) throw new Error("A BZZ block has no valid end marker.");
  return unsort(data, marker);
}

/**
 * The inverse Burrows-Wheeler transform of `data` with its end marker at `marker`: the block's
 * size - 1 original bytes.
 * @param {Uint8Array} data @param {number} marker
 */
function unsort(data, marker) {
  const size = data.length;
  const count = new Uint32Array(256);
  const rank = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    if (i === marker) continue;
    rank[i] = count[data[i]]++;
  }
  let last = 1;
  for (let i = 0; i < 256; i++) {
    const n = count[i];
    count[i] = last;
    last += n;
  }
  const out = new Uint8Array(size - 1);
  let k = 0;
  for (let at = size - 2; at >= 0; at--) {
    const symbol = data[k];
    out[at] = symbol;
    k = count[symbol] + rank[k];
    if (k >= size) throw new Error("A BZZ block does not unsort.");
  }
  if (k !== marker) throw new Error("A BZZ block does not unsort.");
  return out;
}
