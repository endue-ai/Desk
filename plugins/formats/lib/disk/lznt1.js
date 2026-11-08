// LZNT1, the compression NTFS uses for compressed files, from Microsoft's [MS-XCA] section 2.5:
// a buffer of chunks, each standing for 4096 bytes of output, with a two-byte header (the chunk's
// size less three in the low 12 bits, the top bit set when it is compressed). A compressed chunk is
// groups of a flag byte and eight items, a literal byte or a 16-bit back reference whose split
// between offset and length bits follows the position in the chunk.

const CHUNK = 4096;

/**
 * Decode `input` into `size` bytes; bytes no chunk reaches stay zero.
 * @param {Uint8Array} input @param {number} size @returns {Uint8Array}
 */
export function lznt1(input, size) {
  const out = new Uint8Array(size);
  let pos = 0;
  for (let chunk = 0; pos + 2 <= input.length && chunk * CHUNK < size; chunk++) {
    const header = (input[pos] ?? 0) | ((input[pos + 1] ?? 0) << 8);
    if (header === 0) break;
    const end = Math.min(input.length, pos + 3 + (header & 0x0fff));
    const base = chunk * CHUNK;
    const limit = Math.min(size, base + CHUNK);
    pos += 2;
    if (!(header & 0x8000)) {
      const n = Math.min(end - pos, limit - base);
      out.set(input.subarray(pos, pos + n), base);
      pos = end;
      continue;
    }
    let at = base;
    while (pos < end && at < limit) {
      const flags = input[pos++] ?? 0;
      for (let bit = 0; bit < 8 && pos < end && at < limit; bit++) {
        if (!(flags & (1 << bit))) {
          out[at++] = input[pos++] ?? 0;
          continue;
        }
        if (pos + 2 > end) throw new Error("The NTFS compressed data is damaged.");
        const token = (input[pos] ?? 0) | ((input[pos + 1] ?? 0) << 8);
        pos += 2;
        let lengthBits = 12;
        for (let i = at - base - 1; i >= 0x10; i >>= 1) lengthBits--;
        const length = (token & ((1 << lengthBits) - 1)) + 3;
        const distance = (token >>> lengthBits) + 1;
        if (distance > at - base) throw new Error("The NTFS compressed data is damaged.");
        for (let i = 0; i < length && at < limit; i++, at++) out[at] = out[at - distance] ?? 0;
      }
    }
    pos = end;
  }
  return out;
}
