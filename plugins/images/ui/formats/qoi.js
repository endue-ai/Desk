// QOI, the Quite OK Image format: its six operations over a running pixel and a 64-entry index.
import { fail, reader } from "../bytes.js";
import { canvasFor } from "./pixels.js";

/** @returns {import("./pixels.js").Pixels} */
export function decodeQoi(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes, false);
  const width = r.u32(4);
  const height = r.u32(8);
  const channels = r.u8(12);
  const out = canvasFor(width, height);
  const index = new Uint8Array(256);
  let [pr, pg, pb, pa] = [0, 0, 0, 255];
  let at = 14;
  const end = bytes.length;
  const total = width * height * 4;
  for (let p = 0; p < total; ) {
    if (at >= end) fail("The file ends before its pixels do.");
    const b = bytes[at++] ?? 0;
    let run = 1;
    if (b === 0xfe || b === 0xff) {
      if (at + (b === 0xff ? 4 : 3) > end) fail("The file ends before its pixels do.");
      pr = bytes[at++] ?? 0;
      pg = bytes[at++] ?? 0;
      pb = bytes[at++] ?? 0;
      if (b === 0xff) pa = bytes[at++] ?? 0;
    } else if (b >> 6 === 0) {
      const i = (b & 63) * 4;
      [pr, pg, pb, pa] = [index[i] ?? 0, index[i + 1] ?? 0, index[i + 2] ?? 0, index[i + 3] ?? 0];
    } else if (b >> 6 === 1) {
      pr = (pr + ((b >> 4) & 3) - 2) & 255;
      pg = (pg + ((b >> 2) & 3) - 2) & 255;
      pb = (pb + (b & 3) - 2) & 255;
    } else if (b >> 6 === 2) {
      if (at >= end) fail("The file ends before its pixels do.");
      const next = bytes[at++] ?? 0;
      const dg = (b & 63) - 32;
      pr = (pr + dg - 8 + ((next >> 4) & 15)) & 255;
      pg = (pg + dg) & 255;
      pb = (pb + dg - 8 + (next & 15)) & 255;
    } else run = (b & 63) + 1;
    const h = ((pr * 3 + pg * 5 + pb * 7 + pa * 11) % 64) * 4;
    index[h] = pr;
    index[h + 1] = pg;
    index[h + 2] = pb;
    index[h + 3] = pa;
    for (let i = 0; i < run && p < total; i++, p += 4) {
      out[p] = pr;
      out[p + 1] = pg;
      out[p + 2] = pb;
      out[p + 3] = pa;
    }
  }
  return { width, height, rgba: out, depth: `8-bit ${channels === 4 ? "RGBA" : "RGB"}` };
}
