// Finite State Entropy tables (RFC 8878, 4.1): a table description read forwards, the decoding
// table spread from its normalized counts, and the predefined tables for sequences.
import { damaged } from "../input.js";

/** @typedef {{ symbols: Uint8Array, bits: Uint8Array, base: Uint16Array, log: number }} FseTable */

/**
 * The decoding table for normalized counts (-1 is a "less than one" probability).
 * @param {ArrayLike<number>} norm @param {number} count symbols in use @param {number} log
 * @returns {FseTable}
 */
export function buildTable(norm, count, log) {
  const size = 1 << log;
  const symbols = new Uint8Array(size);
  const bits = new Uint8Array(size);
  const base = new Uint16Array(size);
  const next = new Uint16Array(Math.max(count, 1));
  let high = size - 1;
  for (let s = 0; s < count; s++) {
    const n = /** @type {number} */ (norm[s]);
    if (n === -1) {
      if (high < 0) throw damaged("Zstandard", "an entropy table is overfull");
      symbols[high--] = s;
      next[s] = 1;
    } else next[s] = Math.max(n, 0);
  }
  const step = (size >> 1) + (size >> 3) + 3;
  const mask = size - 1;
  let position = 0;
  for (let s = 0; s < count; s++) {
    const n = /** @type {number} */ (norm[s]);
    for (let i = 0; i < n; i++) {
      symbols[position] = s;
      do position = (position + step) & mask;
      while (position > high);
    }
  }
  if (position !== 0) throw damaged("Zstandard", "an entropy table does not add up");
  for (let u = 0; u < size; u++) {
    const s = /** @type {number} */ (symbols[u]);
    const n = /** @type {number} */ (next[s]);
    next[s] = n + 1;
    const nb = log - (31 - Math.clz32(n));
    bits[u] = nb;
    base[u] = (n << nb) - size;
  }
  return { symbols, bits, base, log };
}

/**
 * A table description at b[start..end): its decoding table and how many bytes it took.
 * @param {Uint8Array} b @param {number} start @param {number} end @param {number} maxLog @param {number} maxSymbol
 */
export function readTable(b, start, end, maxLog, maxSymbol) {
  let bit = start * 8;
  const limit = end * 8;
  const peek = () => {
    const i = bit >>> 3;
    return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> (bit & 7);
  };
  if (start >= end) throw damaged("Zstandard", "an entropy table is missing");
  const log = (peek() & 15) + 5;
  bit += 4;
  if (log > maxLog) throw damaged("Zstandard", "an entropy table is too precise");
  const norm = new Int16Array(maxSymbol + 1);
  let remaining = (1 << log) + 1;
  let threshold = 1 << log;
  let nbBits = log + 1;
  let symbol = 0;
  let zero = false;
  while (remaining > 1 && symbol <= maxSymbol) {
    if (zero) {
      for (;;) {
        const repeat = peek() & 3;
        bit += 2;
        symbol += repeat;
        if (repeat !== 3) break;
        if (bit > limit) throw damaged("Zstandard", "an entropy table is cut short");
      }
      if (symbol > maxSymbol) throw damaged("Zstandard", "an entropy table has too many symbols");
    }
    const max = 2 * threshold - 1 - remaining;
    const v = peek();
    let count;
    if ((v & (threshold - 1)) < max) {
      count = v & (threshold - 1);
      bit += nbBits - 1;
    } else {
      count = v & (2 * threshold - 1);
      if (count >= threshold) count -= max;
      bit += nbBits;
    }
    count--;
    remaining -= count < 0 ? -count : count;
    norm[symbol++] = count;
    zero = count === 0;
    while (remaining < threshold && threshold > 1) {
      nbBits--;
      threshold >>= 1;
    }
    if (bit > limit) throw damaged("Zstandard", "an entropy table is cut short");
  }
  if (remaining !== 1) throw damaged("Zstandard", "an entropy table does not add up");
  return { table: buildTable(norm, symbol, log), bytes: ((bit + 7) >>> 3) - start };
}

/** A table that always gives `symbol` and reads no bits. @param {number} symbol @returns {FseTable} */
export const rleTable = (symbol) => ({
  symbols: Uint8Array.of(symbol),
  bits: Uint8Array.of(0),
  base: Uint16Array.of(0),
  log: 0,
});

// The predefined distributions (RFC 8878, 3.1.1.3.2.2).
export const LL_DEFAULT = buildTable(
  [
    4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1,
    -1, -1, -1, -1,
  ],
  36,
  6,
);
export const ML_DEFAULT = buildTable(
  [
    1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
  ],
  53,
  6,
);
export const OF_DEFAULT = buildTable(
  [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1],
  29,
  5,
);
