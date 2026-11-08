// DEFLATE (RFC 1951) and its zlib wrapper (RFC 1950), synchronous and in plain JavaScript: the same
// decoder as plugins/web/ui/inflate.js. The platform's DecompressionStream refuses bytes after the
// end of a stream, and QCOW2 packs compressed clusters back to back, so a cluster's last sector
// holds the start of the next one; this decoder stops at the end of the stream and ignores them.

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/**
 * A Huffman decoding table: for every `bits`-bit window, least significant bit first, the symbol
 * shifted left by four with its code length below; -1 where no code fits.
 * @param {ArrayLike<number>} lengths
 */
function huffman(lengths) {
  let bits = 0;
  const count = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i] ?? 0;
    count[length]++;
    if (length > bits) bits = length;
  }
  const codes = new Int32Array(1 << bits).fill(-1);
  count[0] = 0;
  const next = new Uint16Array(16);
  for (let length = 1, code = 0; length <= 15; length++) {
    code = (code + (count[length - 1] ?? 0)) << 1;
    next[length] = code;
  }
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol] ?? 0;
    if (!length) continue;
    const code = next[length]++;
    let reversed = 0;
    for (let i = 0; i < length; i++) reversed |= ((code >> i) & 1) << (length - 1 - i);
    for (let i = reversed; i < codes.length; i += 1 << length) codes[i] = (symbol << 4) | length;
  }
  return { bits, codes };
}

const FIXED = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return { literal: huffman(lengths), distance: huffman(new Uint8Array(30).fill(5)) };
})();

/**
 * Inflate raw DEFLATE data starting at `start`.
 * @param {Uint8Array} input
 * @param {number} [start]
 * @param {number} [expected] the decoded size when known, to size the output once
 * @returns {{ data: Uint8Array, end: number }} the decoded bytes and where the compressed data ended
 */
export function inflateRaw(input, start = 0, expected = 0) {
  let pos = start;
  let bitBuffer = 0;
  let bitCount = 0;
  let padding = 0;
  let out = new Uint8Array(Math.max(1024, expected || (input.length - start) * 4));
  let size = 0;

  const need = (/** @type {number} */ n) => {
    while (bitCount < n) {
      if (pos < input.length) bitBuffer |= (input[pos] ?? 0) << bitCount;
      else padding++;
      pos++;
      bitCount += 8;
    }
  };
  const bits = (/** @type {number} */ n) => {
    need(n);
    const value = bitBuffer & ((1 << n) - 1);
    bitBuffer >>>= n;
    bitCount -= n;
    if (padding * 8 > bitCount) throw new Error("The compressed data ends too early.");
    return value;
  };
  const decode = (/** @type {{ bits: number, codes: Int32Array }} */ table) => {
    need(table.bits);
    const entry = table.codes[bitBuffer & ((1 << table.bits) - 1)] ?? -1;
    if (entry < 0) throw new Error("The compressed data is damaged.");
    const length = entry & 15;
    bitBuffer >>>= length;
    bitCount -= length;
    if (padding * 8 > bitCount) throw new Error("The compressed data ends too early.");
    return entry >> 4;
  };
  const room = (/** @type {number} */ n) => {
    if (size + n <= out.length) return;
    let length = out.length * 2;
    while (length < size + n) length *= 2;
    const grown = new Uint8Array(length);
    grown.set(out.subarray(0, size));
    out = grown;
  };

  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      // A stored block starts on a byte boundary: give back the whole bytes already buffered.
      const whole = bitCount >> 3;
      pos -= whole;
      bitBuffer = 0;
      bitCount = 0;
      padding = 0;
      if (pos + 4 > input.length) throw new Error("The compressed data ends too early.");
      const length = (input[pos] ?? 0) | ((input[pos + 1] ?? 0) << 8);
      pos += 4;
      if (pos + length > input.length) throw new Error("The compressed data ends too early.");
      room(length);
      out.set(input.subarray(pos, pos + length), size);
      size += length;
      pos += length;
      continue;
    }
    if (type === 3) throw new Error("The compressed data is damaged.");
    let tables = FIXED;
    if (type === 2) {
      const literals = bits(5) + 257;
      const distances = bits(5) + 1;
      const lengthCodes = bits(4) + 4;
      const order = new Uint8Array(19);
      for (let i = 0; i < lengthCodes; i++) order[ORDER[i] ?? 0] = bits(3);
      const lengthTable = huffman(order);
      const lengths = new Uint8Array(literals + distances);
      for (let i = 0; i < lengths.length; ) {
        const symbol = decode(lengthTable);
        if (symbol < 16) lengths[i++] = symbol;
        else {
          const [repeat, value] =
            symbol === 16
              ? [3 + bits(2), i > 0 ? (lengths[i - 1] ?? 0) : -1]
              : symbol === 17
                ? [3 + bits(3), 0]
                : [11 + bits(7), 0];
          if (value < 0 || i + repeat > lengths.length)
            throw new Error("The compressed data is damaged.");
          lengths.fill(value, i, i + repeat);
          i += repeat;
        }
      }
      tables = {
        literal: huffman(lengths.subarray(0, literals)),
        distance: huffman(lengths.subarray(literals)),
      };
    }
    for (;;) {
      const symbol = decode(tables.literal);
      if (symbol < 256) {
        room(1);
        out[size++] = symbol;
        continue;
      }
      if (symbol === 256) break;
      const index = symbol - 257;
      if (index >= 29) throw new Error("The compressed data is damaged.");
      const length = (LENGTH_BASE[index] ?? 0) + bits(LENGTH_EXTRA[index] ?? 0);
      const code = decode(tables.distance);
      if (code >= 30) throw new Error("The compressed data is damaged.");
      const distance = (DIST_BASE[code] ?? 0) + bits(DIST_EXTRA[code] ?? 0);
      if (distance > size) throw new Error("The compressed data is damaged.");
      room(length);
      for (let i = 0; i < length; i++, size++) out[size] = out[size - distance] ?? 0;
    }
  }
  // The bytes buffered past the last block belong to whatever follows.
  const end = pos - (bitCount >> 3);
  return { data: out.subarray(0, size), end };
}

/**
 * zlib-wrapped DEFLATE, as VMDK grains hold it; raw DEFLATE when the two-byte header is missing.
 * @param {Uint8Array} input @param {number} [expected] the decoded size when known
 */
export function inflateZlib(input, expected = 0) {
  const cmf = input[0] ?? 0;
  const wrapped = (cmf & 15) === 8 && ((cmf << 8) | (input[1] ?? 0)) % 31 === 0;
  return inflateRaw(input, wrapped ? 2 : 0, expected).data;
}
