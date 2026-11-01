// LZO1X, the stream SquashFS keeps in LZO-compressed blocks: literal runs and matches told apart by
// their first byte and by how many literals the instruction before copied, ending with the marker
// 0x11 0x00 0x00. Written from the documented stream format; one call decodes one whole block.

/** @param {string} why */
const damaged = (why) => new Error(`The LZO data is damaged: ${why}.`);

/**
 * Decode one LZO1X stream into at most `max` bytes.
 * @param {Uint8Array} src @param {number} max @returns {Uint8Array}
 */
export function lzo1x(src, max) {
  const out = new Uint8Array(max);
  const end = src.length;
  let ip = 0;
  let op = 0;
  /** The next input byte. */
  const byte = () => {
    if (ip >= end) throw damaged("the data ends early");
    return /** @type {number} */ (src[ip++]);
  };
  /** A length that goes on in zero bytes of 255 each and one last byte. @param {number} base */
  const longer = (base) => {
    let n = base;
    for (let b = byte(); b === 0; b = byte()) {
      n += 255;
      if (n > max + 255) throw damaged("a length runs past the block");
    }
    return n + /** @type {number} */ (src[ip - 1]);
  };
  /** @param {number} n */
  const literals = (n) => {
    if (ip + n > end) throw damaged("literals run past the data");
    if (op + n > max) throw damaged("the data decodes to more than a block");
    out.set(src.subarray(ip, ip + n), op);
    ip += n;
    op += n;
  };
  /** @param {number} distance @param {number} length */
  const copy = (distance, length) => {
    if (distance > op) throw damaged("a match reaches back before the data");
    if (op + length > max) throw damaged("the data decodes to more than a block");
    let from = op - distance;
    if (distance >= length) {
      out.copyWithin(op, from, from + length);
      op += length;
    } else for (let k = 0; k < length; k++) out[op++] = /** @type {number} */ (out[from++]);
  };

  // How many literals the last instruction copied: 0, 1 to 3, or 4 for a longer run.
  let state = 0;
  if (end > 0 && /** @type {number} */ (src[0]) > 17) {
    const n = byte() - 17;
    literals(n);
    state = Math.min(n, 4);
  }
  for (;;) {
    const t = byte();
    let tail;
    if (t < 16) {
      if (state === 0) {
        // A run of four or more literals.
        literals((t === 0 ? longer(15) : t) + 3);
        state = 4;
        continue;
      }
      const h = byte();
      if (state === 4) copy((h << 2) + (t >> 2) + 2049, 3);
      else copy((h << 2) + (t >> 2) + 1, 2);
      tail = t & 3;
    } else if (t >= 64) {
      // Three to eight bytes within 2 KiB.
      copy((byte() << 3) + ((t >> 2) & 7) + 1, (t >> 5) + 1);
      tail = t & 3;
    } else if (t >= 32) {
      // Within 16 KiB.
      const length = (t & 31 || longer(31)) + 2;
      const low = byte();
      const word = low | (byte() << 8);
      copy((word >> 2) + 1, length);
      tail = low & 3;
    } else {
      // Within 16 to 48 KiB, or the end of the stream.
      const length = (t & 7 || longer(7)) + 2;
      const low = byte();
      const word = low | (byte() << 8);
      const distance = 16384 + ((t & 8) << 11) + (word >> 2);
      if (distance === 16384) {
        if (length !== 3) throw damaged("the end marker is not whole");
        if (ip !== end) throw damaged("data follows the end marker");
        return out.subarray(0, op);
      }
      copy(distance, length);
      tail = low & 3;
    }
    literals(tail);
    state = tail;
  }
}
