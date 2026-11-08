// Apple icon files: every entry, and the largest one shown. PNG entries (ic07 to ic14, icp4 to
// icp6) go to the webview; the RLE entries (it32, ih32, il32, is32 and the ARGB ic04/ic05) are
// decoded here, with their 8-bit masks (t8mk, h8mk, l8mk, s8mk).
import { ascii, fail, has, reader } from "../bytes.js";
import { canvasFor } from "./pixels.js";

const RLE = /** @type {Record<string, [number, string]>} */ ({
  it32: [128, "t8mk"],
  ih32: [48, "h8mk"],
  il32: [32, "l8mk"],
  is32: [16, "s8mk"],
});
const ARGB = /** @type {Record<string, number>} */ ({ ic04: 16, ic05: 32 });

/** Apple's packbits: a byte below 128 copies that many plus one, above it repeats the next. */
function unpack(
  /** @type {Uint8Array} */ data,
  /** @type {number} */ at,
  /** @type {number} */ count,
) {
  const out = new Uint8Array(count);
  let o = 0;
  while (o < count && at < data.length) {
    const c = data[at++] ?? 0;
    if (c & 0x80) {
      const n = c - 125;
      out.fill(data[at++] ?? 0, o, Math.min(count, o + n));
      o += n;
    } else {
      const n = c + 1;
      out.set(data.subarray(at, at + Math.min(n, count - o)), o);
      o += n;
      at += n;
    }
  }
  return { channel: out, at };
}

/**
 * @returns {import("./pixels.js").Pixels | import("./pixels.js").Web}
 */
export function decodeIcns(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes, false);
  /** @type {Map<string, Uint8Array>} */
  const entries = new Map();
  for (let at = 8; at + 8 <= Math.min(bytes.length, r.u32(4)); ) {
    const size = r.u32(at + 4);
    if (size < 8) break;
    entries.set(ascii(bytes, at, 4), bytes.subarray(at + 8, at + size));
    at += size;
  }
  /** @type {{ size: number, type: string, data: Uint8Array } | null} */
  let best = null;
  for (const [type, data] of entries) {
    let size = 0;
    if (has(data, 0, [0x89, 0x50, 0x4e, 0x47])) size = reader(data, false).u32(16);
    else if (RLE[type]) size = RLE[type][0];
    else if (ARGB[type] && has(data, 0, "ARGB")) size = ARGB[type];
    if (size > (best?.size ?? 0) || (size === best?.size && has(data, 0, [0x89, 0x50])))
      best = { size, type, data };
  }
  const rows = [{ label: "Entries", value: [...entries.keys()].join(", ") }];
  if (!best) {
    if ([...entries.values()].some((d) => has(d, 4, "jP  ")))
      return fail("Its icons are JPEG 2000, which Images does not read.");
    return fail("It holds no icon Images can show.");
  }
  if (has(best.data, 0, [0x89, 0x50, 0x4e, 0x47]))
    return {
      web: { mime: "image/png", data: best.data, width: best.size, height: best.size },
      rows,
      depth: `PNG entry ${best.type}`,
    };

  const { size, type, data } = best;
  const out = canvasFor(size, size);
  const count = size * size;
  const planes = [];
  let at = type === "it32" ? 4 : ARGB[type] ? 4 : 0;
  if (ARGB[type]) {
    for (let c = 0; c < 4; c++) ({ channel: planes[c], at } = unpack(data, at, count));
  } else {
    for (let c = 0; c < 3; c++) ({ channel: planes[c], at } = unpack(data, at, count));
    const mask = entries.get(RLE[type]?.[1] ?? "");
    planes[3] = mask && mask.length >= count ? mask : new Uint8Array(count).fill(255);
  }
  const [cr, cg, cb, ca] = ARGB[type] ? [planes[1], planes[2], planes[3], planes[0]] : planes;
  for (let i = 0; i < count; i++) {
    out[i * 4] = cr?.[i] ?? 0;
    out[i * 4 + 1] = cg?.[i] ?? 0;
    out[i * 4 + 2] = cb?.[i] ?? 0;
    out[i * 4 + 3] = ca?.[i] ?? 255;
  }
  return { width: size, height: size, rgba: out, depth: `RLE entry ${type}`, rows };
}
