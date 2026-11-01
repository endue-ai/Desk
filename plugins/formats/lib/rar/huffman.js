// Canonical Huffman codes as both RAR formats send them: a code length (0 to 15) per symbol, codes
// assigned in order of length and then symbol. Decoding looks short codes up in a table and finds
// longer ones by comparing the next 16 bits against the first code of each length.

export class Huffman {
  /** @param {number} size symbols in the alphabet @param {number} quick bits of the lookup table */
  constructor(size, quick) {
    this.size = size;
    this.quick = quick;
    /** limit[n]: the first 16-bit-aligned code longer than n bits. */
    this.limit = new Uint32Array(17);
    /** first[n]: where the symbols of length n start in `symbols`. */
    this.first = new Uint32Array(17);
    this.symbols = new Uint16Array(size);
    this.quickLength = new Uint8Array(1 << quick);
    this.quickSymbol = new Uint16Array(1 << quick);
  }

  /** Builds the code from `count` lengths at `lengths[from]`. @param {Uint8Array} lengths @param {number} from */
  build(lengths, from) {
    const counts = new Uint32Array(16);
    for (let i = 0; i < this.size; i++) counts[/** @type {number} */ (lengths[from + i]) & 15]++;
    counts[0] = 0;
    let code = 0;
    this.first[0] = 0;
    this.limit[0] = 0;
    for (let n = 1; n < 16; n++) {
      code += /** @type {number} */ (counts[n]);
      this.limit[n] = code << (16 - n);
      this.first[n] =
        /** @type {number} */ (this.first[n - 1]) + /** @type {number} */ (counts[n - 1]);
      code <<= 1;
    }
    this.limit[16] = 0x10000;
    const next = this.first.slice();
    this.symbols.fill(0);
    for (let i = 0; i < this.size; i++) {
      const n = /** @type {number} */ (lengths[from + i]) & 15;
      if (n) this.symbols[next[n]++] = i;
    }
    const quick = this.quick;
    for (let c = 0, n = 0; c < 1 << quick; c++) {
      const bits = c << (16 - quick);
      while (n < 16 && bits >= /** @type {number} */ (this.limit[n])) n++;
      this.quickLength[c] = n;
      const at =
        /** @type {number} */ (this.first[n & 15]) +
        ((bits - /** @type {number} */ (this.limit[n - 1] ?? 0)) >>> (16 - n));
      this.quickSymbol[c] = n < 16 && at < this.size ? /** @type {number} */ (this.symbols[at]) : 0;
    }
  }

  /** The next symbol from `input` (a symbol 0 when the code is not in the table). @param {import("./input.js").Input} input */
  decode(input) {
    const bits = input.peek16() & 0xfffe;
    if (bits < /** @type {number} */ (this.limit[this.quick])) {
      const c = bits >>> (16 - this.quick);
      input.pos += /** @type {number} */ (this.quickLength[c]);
      return /** @type {number} */ (this.quickSymbol[c]);
    }
    let n = this.quick + 1;
    while (n < 15 && bits >= /** @type {number} */ (this.limit[n])) n++;
    input.pos += n;
    const at =
      /** @type {number} */ (this.first[n]) +
      ((bits - /** @type {number} */ (this.limit[n - 1])) >>> (16 - n));
    return at < this.size ? /** @type {number} */ (this.symbols[at]) : 0;
  }
}
