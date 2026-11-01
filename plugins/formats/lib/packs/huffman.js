// Canonical Huffman codes as XPRESS and LZX send them: a length per symbol, codes given in order of
// length and then symbol, read most significant bit first. Short codes are looked up in one table,
// longer ones in a small second-level table under their first bits.

/**
 * A decoding table over `maxBits`-bit peeks. An entry holds `symbol << 5 | length`; an entry with
 * length 0 points at a second-level table (its index << 5), and 0 marks a code no symbol has.
 */
export class Huffman {
  /**
   * @param {Uint8Array} lengths a length per symbol, 0 for symbols the data does not use
   * @param {number} maxBits the longest code the format allows (the width of a peek)
   * @param {number} tableBits bits looked up at once
   * @param {(why: string) => Error} damaged the format's error for a code that cannot be
   */
  constructor(lengths, maxBits, tableBits, damaged) {
    this.maxBits = maxBits;
    this.tableBits = Math.min(tableBits, maxBits);
    this.subBits = maxBits - this.tableBits;
    this.damaged = damaged;
    const counts = new Uint32Array(maxBits + 1);
    for (let s = 0; s < lengths.length; s++) {
      const n = /** @type {number} */ (lengths[s]);
      if (n > maxBits) throw damaged("a code is longer than the format allows");
      counts[n] = /** @type {number} */ (counts[n]) + 1;
    }
    counts[0] = 0;
    // The first code of each length; more codes than a length has room for is no prefix code.
    const next = new Uint32Array(maxBits + 2);
    let code = 0;
    for (let n = 1; n <= maxBits; n++) {
      code = (code + /** @type {number} */ (counts[n - 1])) << 1;
      next[n] = code;
      if (code + /** @type {number} */ (counts[n]) > 2 ** n)
        throw damaged("its Huffman code lengths do not form a prefix code");
    }
    const primary = 1 << this.tableBits;
    /** @type {number[]} */
    const table = new Array(primary).fill(0);
    for (let s = 0; s < lengths.length; s++) {
      const n = /** @type {number} */ (lengths[s]);
      if (!n) continue;
      const c = /** @type {number} */ (next[n]);
      next[n] = c + 1;
      const entry = (s << 5) | n;
      if (n <= this.tableBits) {
        const from = c << (this.tableBits - n);
        table.fill(entry, from, from + (1 << (this.tableBits - n)));
        continue;
      }
      const prefix = c >>> (n - this.tableBits);
      let sub = /** @type {number} */ (table[prefix]);
      if (!sub) {
        sub = table.length << 5;
        table[prefix] = sub;
        for (let k = 0; k < 1 << this.subBits; k++) table.push(0);
      }
      const rest = c & ((1 << (n - this.tableBits)) - 1);
      const from = (sub >>> 5) + (rest << (maxBits - n));
      table.fill(entry, from, from + (1 << (maxBits - n)));
    }
    this.table = Int32Array.from(table);
  }

  /**
   * The `symbol << 5 | length` entry for the next `maxBits` bits of the stream.
   * @param {number} bits the next maxBits bits, most significant first
   */
  entry(bits) {
    let e = /** @type {number} */ (this.table[bits >>> this.subBits]);
    if (e && !(e & 31))
      e = /** @type {number} */ (this.table[(e >>> 5) + (bits & ((1 << this.subBits) - 1))]);
    if (!e) throw this.damaged("a Huffman code that no symbol has was read");
    return e;
  }
}
