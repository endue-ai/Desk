// EPS, WMF and EMF, which Images does not render. EPS shows the preview it carries: the TIFF of a
// DOS EPS binary header (through the webview) or an EPSI bitmap in its comments; without one, and
// for WMF and EMF, the details view gives the bounds and, for metafiles, the record count.
import { ascii, fail, has, reader } from "../bytes.js";
import { canvasFor } from "./pixels.js";

/** A DOS EPS's TIFF preview, an EPSI preview, or the details. */
export function decodeEps(/** @type {Uint8Array} */ bytes) {
  const binary = has(bytes, 0, [0xc5, 0xd0, 0xd3, 0xc6]);
  const r = reader(bytes);
  const ps = binary ? bytes.subarray(r.u32(4), r.u32(4) + r.u32(8)) : bytes;
  const text = ascii(ps, 0, Math.min(ps.length, 1 << 20));
  const box = text.match(/%%BoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
  const rows = box
    ? [
        {
          label: "Bounds",
          value: `${Number(box[3]) - Number(box[1])} × ${Number(box[4]) - Number(box[2])} pt`,
        },
      ]
    : [];
  if (binary && r.u32(24) > 0) {
    const data = bytes.subarray(r.u32(20), r.u32(20) + r.u32(24));
    return { web: { mime: "image/tiff", data, label: "Embedded preview" }, rows };
  }
  const preview = text.match(
    /%%BeginPreview:\s*(\d+)\s+(\d+)\s+(\d+)\s+\d+\s*\r?\n([\s\S]*?)%%EndPreview/,
  );
  if (preview) {
    const [width, height, depth] = [Number(preview[1]), Number(preview[2]), Number(preview[3])];
    const hex = (preview[4] ?? "").replace(/[%\s]/g, "");
    const out = canvasFor(width, height);
    const row = Math.ceil((width * depth) / 8);
    const max = 2 ** depth - 1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const bit = x * depth;
        const byte =
          Number.parseInt(
            hex.slice((y * row + (bit >> 3)) * 2, (y * row + (bit >> 3)) * 2 + 2),
            16,
          ) || 0;
        const v = (byte >> (8 - depth - (bit & 7))) & max;
        // EPSI: 0 is white.
        const g = 255 - Math.round((v * 255) / max);
        out.set([g, g, g, 255], (y * width + x) * 4);
      }
    return {
      width,
      height,
      rgba: out,
      depth: `${depth}-bit greyscale EPSI preview`,
      rows,
      label: "Embedded preview",
    };
  }
  return { reason: "It carries no preview, and Images does not render PostScript.", rows };
}

/** A WMF's placeable bounds and its records, counted. */
export function decodeWmf(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes);
  const placeable = has(bytes, 0, [0xd7, 0xcd, 0xc6, 0x9a]);
  const start = placeable ? 22 : 0;
  const headerWords = r.u16(start + 2);
  if (headerWords !== 9) fail("Its WMF header is damaged.");
  let records = 0;
  /** @type {number[] | undefined} */
  let extent;
  for (let at = start + 18; at + 6 <= bytes.length; records++) {
    const words = r.u32(at);
    const fn = r.u16(at + 4);
    if (fn === 0x020c && !extent) extent = [r.i16(at + 8), r.i16(at + 6)];
    if (fn === 0 || words < 3) break;
    at += words * 2;
  }
  const rows = [];
  if (placeable) {
    const [left, top, right, bottom, inch] = [
      r.i16(6),
      r.i16(8),
      r.i16(10),
      r.i16(12),
      r.u16(14) || 1440,
    ];
    const [w, h] = [Math.abs(right - left), Math.abs(bottom - top)];
    rows.push({
      label: "Bounds",
      value: `${w} × ${h} units, ${((w / inch) * 25.4).toFixed(1)} × ${((h / inch) * 25.4).toFixed(1)} mm`,
    });
  } else if (extent)
    rows.push({
      label: "Bounds",
      value: `${Math.abs(extent[0] ?? 0)} × ${Math.abs(extent[1] ?? 0)} units`,
    });
  rows.push({ label: "Records", value: String(records + 1) });
  return {
    reason: "Images shows a metafile's bounds and records; it does not draw metafiles.",
    rows,
  };
}

/** An EMF's header: bounds, frame and record count. */
export function decodeEmf(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes);
  const [left, top, right, bottom] = [r.i32(8), r.i32(12), r.i32(16), r.i32(20)];
  const [fl, ft, fr, fb] = [r.i32(24), r.i32(28), r.i32(32), r.i32(36)];
  const records = r.u32(52);
  const plus = bytes.length > 108 + 16 && ascii(bytes, r.u32(4) + 12, 4) === "EMF+";
  return {
    reason: "Images shows a metafile's bounds and records; it does not draw metafiles.",
    rows: [
      { label: "Bounds", value: `${right - left + 1} × ${bottom - top + 1} device units` },
      {
        label: "Frame",
        value: `${((fr - fl) / 100).toFixed(1)} × ${((fb - ft) / 100).toFixed(1)} mm`,
      },
      { label: "Records", value: `${records}${plus ? ", EMF+" : ""}` },
    ],
  };
}
