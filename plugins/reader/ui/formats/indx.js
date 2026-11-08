// MOBI and KF8 indexes (INDX records): the TAGX table that says how each entry's control byte and
// variable-width values read, the entries' names, and the CNCX records holding their strings.
import { ascii, u16, u32 } from "./bytes.js";

/** @typedef {{ name: string, tags: Map<number, number[]> }} IndexEntry */

/** A forward variable-width integer: seven bits a byte, the last byte's high bit set. */
function vwi(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  let value = 0;
  let n = 0;
  for (; n < 5; n++) {
    const byte = b[at + n] ?? 0x80;
    value = value * 128 + (byte & 0x7f);
    if (byte & 0x80) break;
  }
  return { value, size: n + 1 };
}

const bitsSet = (/** @type {number} */ mask) => mask.toString(2).replace(/0/g, "").length;

/**
 * @param {Uint8Array[]} records The book's records.
 * @param {number} at The index's first (header) record.
 * @returns {{ entries: IndexEntry[], cncx: Map<number, string> }}
 */
export function readIndex(records, at) {
  const head = records[at];
  if (!head || ascii(head, 0, 4) !== "INDX") return { entries: [], cncx: new Map() };
  const count = u32(head, 24);
  const strings = u32(head, 52);
  const tagx = u32(head, 4);
  /** @type {Array<[tag: number, values: number, mask: number, end: number]>} */
  const tags = [];
  let controlBytes = 1;
  if (ascii(head, tagx, 4) === "TAGX") {
    const length = u32(head, tagx + 4);
    controlBytes = u32(head, tagx + 8);
    for (let t = tagx + 12; t < tagx + length; t += 4)
      tags.push([head[t] ?? 0, head[t + 1] ?? 0, head[t + 2] ?? 0, head[t + 3] ?? 0]);
  }
  /** @type {Map<number, string>} */
  const cncx = new Map();
  for (let c = 0; c < strings; c++) {
    const record = records[at + count + 1 + c];
    if (!record) break;
    for (let o = 0; o < record.length && record[o] !== 0; ) {
      const { value, size } = vwi(record, o);
      cncx.set(
        c * 0x10000 + o,
        new TextDecoder().decode(record.subarray(o + size, o + size + value)),
      );
      o += size + value;
    }
  }
  /** @type {IndexEntry[]} */
  const entries = [];
  for (let r = at + 1; r <= at + count; r++) {
    const data = records[r];
    if (!data || ascii(data, 0, 4) !== "INDX") continue;
    const idxt = u32(data, 20);
    const n = u32(data, 24);
    const starts = Array.from({ length: n }, (_, j) => u16(data, idxt + 4 + j * 2));
    starts.push(idxt);
    for (let j = 0; j < n; j++) {
      const start = starts[j] ?? 0;
      const nameLength = data[start] ?? 0;
      const name = new TextDecoder().decode(data.subarray(start + 1, start + 1 + nameLength));
      const control = start + 1 + nameLength;
      let pos = control + controlBytes;
      /** @type {Array<[tag: number, count: number | null, bytes: number | null, values: number]>} */
      const present = [];
      let controlIndex = 0;
      for (const [tag, values, mask, end] of tags) {
        if (end === 1) {
          controlIndex++;
          continue;
        }
        let v = (data[control + controlIndex] ?? 0) & mask;
        if (v === 0) continue;
        if (v === mask && bitsSet(mask) > 1) {
          const width = vwi(data, pos);
          pos += width.size;
          present.push([tag, null, width.value, values]);
        } else {
          let m = mask;
          while ((m & 1) === 0) {
            m >>= 1;
            v >>= 1;
          }
          present.push([tag, v, null, values]);
        }
      }
      /** @type {Map<number, number[]>} */
      const map = new Map();
      for (const [tag, countOf, bytes, values] of present) {
        const out = [];
        if (countOf !== null) {
          for (let k = 0; k < countOf * values; k++) {
            const { value, size } = vwi(data, pos);
            out.push(value);
            pos += size;
          }
        } else {
          for (let used = 0; used < (bytes ?? 0); ) {
            const { value, size } = vwi(data, pos);
            out.push(value);
            pos += size;
            used += size;
          }
        }
        map.set(tag, out);
      }
      entries.push({ name, tags: map });
    }
  }
  return { entries, cncx };
}
