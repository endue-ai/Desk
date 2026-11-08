// ADC (Apple Data Compression), the LZ coder of UDCO images: a byte with its top bit set starts
// a run of (b & 0x7f) + 1 literals; otherwise it starts a copy, three bytes long when bit 6 is set
// (length (b & 0x3f) + 4, a 16-bit distance) and two bytes long when not (length ((b >> 2) & 15)
// + 3, a 10-bit distance), each distance one less than it is.

/**
 * Decode ADC into exactly `size` bytes.
 * @param {Uint8Array} input @param {number} size @returns {Uint8Array}
 */
export function decodeAdc(input, size) {
  const out = new Uint8Array(size);
  let pos = 0;
  let i = 0;
  const damaged = () => new Error("The ADC chunk is damaged: a copy reaches outside the data.");
  while (pos < size) {
    if (i >= input.length) throw new Error("The ADC chunk ends early.");
    const b = /** @type {number} */ (input[i++]);
    if (b & 0x80) {
      const n = (b & 0x7f) + 1;
      if (i + n > input.length || pos + n > size) throw damaged();
      out.set(input.subarray(i, i + n), pos);
      i += n;
      pos += n;
      continue;
    }
    let length;
    let distance;
    if (b & 0x40) {
      if (i + 2 > input.length) throw new Error("The ADC chunk ends early.");
      length = (b & 0x3f) + 4;
      distance = (((input[i] ?? 0) << 8) | (input[i + 1] ?? 0)) + 1;
      i += 2;
    } else {
      if (i + 1 > input.length) throw new Error("The ADC chunk ends early.");
      length = ((b >> 2) & 0x0f) + 3;
      distance = (((b & 3) << 8) | (input[i] ?? 0)) + 1;
      i += 1;
    }
    if (distance > pos || pos + length > size) throw damaged();
    for (let k = 0; k < length; k++, pos++) out[pos] = out[pos - distance] ?? 0;
  }
  return out;
}
