// Pictures. An inline picture is a PICF in the Data stream ([MS-DOC] 2.9.192 PICFAndOfficeArtData)
// followed by an OfficeArt shape and its BLIPs ([MS-ODRAW] 2.2.15, 2.2.23). PNG, JPEG, GIF, TIFF and
// DIB (as BMP) show; EMF, WMF and PICT become a placeholder that names them.
import { decode, pictureUrl, Reader } from "../bytes.js";
import { pt } from "../model.js";

/**
 * @typedef {{ type: number, instance: number, body: number, end: number }} Rec
 * @typedef {{ pib?: number, txid?: number, name?: string, description?: string }} ShapeProps
 * @typedef {{ src: string | null, kind: string }} Blip
 */

/** An OfficeArt record header at `at`. @param {Reader} r @param {number} at @returns {Rec} */
export function record(r, at) {
  const head = r.u16(at);
  return { type: r.u16(at + 2), instance: head >> 4, body: at + 8, end: at + 8 + r.u32(at + 4) };
}

/** The records in [from, to), stopping at anything that is not one. */
export function records(/** @type {Reader} */ r, /** @type {number} */ from, to = 0) {
  /** @type {Rec[]} */
  const out = [];
  let at = from;
  while (at + 8 <= to) {
    const rec = record(r, at);
    if (rec.type < 0xf000 || rec.end > to || rec.end <= at) break;
    out.push(rec);
    at = rec.end;
  }
  return out;
}

const utf16z = (/** @type {Reader} */ r, /** @type {number} */ at, /** @type {number} */ size) => {
  let out = "";
  for (let i = 0; i + 1 < size; i += 2) {
    const code = r.u16(at + i);
    if (code === 0) break;
    if (code < 0x20) return "";
    out += String.fromCharCode(code);
  }
  return out.trim();
};

/**
 * What a shape's property tables (OfficeArtFOPT, [MS-ODRAW] 2.2.9) say: the BLIP it shows, its
 * text box, its name and description.
 * @param {Reader} r
 * @param {Rec[]} recs the shape container's records
 * @returns {ShapeProps}
 */
export function shapeProps(r, recs) {
  /** @type {ShapeProps} */
  const out = {};
  for (const rec of recs) {
    if (rec.type !== 0xf00b && rec.type !== 0xf122) continue;
    let complex = rec.body + rec.instance * 6;
    for (let i = 0; i < rec.instance; i++) {
      const at = rec.body + i * 6;
      const opid = r.u16(at);
      const id = opid & 0x3fff;
      const op = r.i32(at + 2);
      if (opid & 0x8000) {
        if (id === 0x380) out.name = utf16z(r, complex, op);
        if (id === 0x381) out.description = utf16z(r, complex, op);
        complex += Math.max(0, op);
      } else if (id === 0x104 || (id === 0x186 && out.pib === undefined)) out.pib = op;
      else if (id === 0x80) out.txid = op;
    }
  }
  return out;
}

const KINDS = new Map([
  [0xf01a, "EMF"],
  [0xf01b, "WMF"],
  [0xf01c, "PICT"],
]);

/**
 * The picture in a BLIP record ([MS-ODRAW] 2.2.23): its bytes after one or two 16-byte UIDs and
 * a tag byte (bitmaps) or a 34-byte metafile header (metafiles).
 * @param {Uint8Array} bytes
 * @param {Rec} rec
 * @returns {Blip}
 */
export function blipOf(bytes, rec) {
  const kind = KINDS.get(rec.type);
  if (kind) return { src: null, kind };
  if (rec.type < 0xf018 || rec.type > 0xf117) return { src: null, kind: "unknown" };
  const uids = rec.instance & 1 ? 32 : 16;
  const data = bytes.subarray(rec.body + uids + 1, rec.end);
  const src = rec.type === 0xf01f ? pictureUrl(bmpOf(data)) : pictureUrl(data);
  return { src, kind: rec.type === 0xf01f ? "BMP" : "picture" };
}

/** A DIB (a BITMAPINFOHEADER and pixels) as a BMP file. */
function bmpOf(/** @type {Uint8Array} */ dib) {
  const r = new Reader(dib);
  const header = r.u32(0);
  const bits = r.u16(14);
  const colors = r.u32(32) || (bits <= 8 ? 1 << bits : 0);
  const masks = header === 40 && r.u32(16) === 3 ? 12 : 0;
  const offset = 14 + header + (header >= 40 ? colors * 4 : colors * 3) + masks;
  const out = new Uint8Array(14 + dib.length);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, out.length, true);
  view.setUint32(10, offset, true);
  out.set(dib, 14);
  return out;
}

/**
 * An image of the model for a BLIP, with a placeholder's words when it cannot be shown.
 * @param {Blip | undefined} blip
 * @param {string} alt
 * @param {number | undefined} width points
 * @param {number | undefined} height points
 * @returns {import("../model.js").Image}
 */
export function imageOf(blip, alt, width, height) {
  /** @type {import("../model.js").Image} */
  const image = { type: "image", src: blip?.src ?? null, alt };
  if (width) image.width = width;
  if (height) image.height = height;
  if (!image.src) {
    const kind = blip?.kind ?? "unknown";
    image.alt = ["unknown", "picture", "drawing"].includes(kind)
      ? `${alt} (not shown)`
      : `${alt} (${kind}, not shown)`;
  }
  return image;
}

/**
 * The inline picture whose PICFAndOfficeArtData starts at `fc` in the Data stream.
 * @param {Uint8Array | undefined} data
 * @param {number} fc
 * @returns {import("../model.js").Image}
 */
export function inlinePicture(data, fc) {
  if (!data || fc < 0 || fc + 0x44 > data.length) return imageOf(undefined, "Picture", 0, 0);
  const r = new Reader(data);
  const lcb = r.i32(fc);
  const cbHeader = r.u16(fc + 4);
  const mm = r.i16(fc + 6);
  const end = Math.min(data.length, fc + lcb);
  const scale = (/** @type {number} */ goal, /** @type {number} */ m) =>
    pt((Math.max(0, goal) * (m || 1000)) / 1000 / 20) || undefined;
  const width = scale(r.i16(fc + 0x1c), r.u16(fc + 0x20));
  const height = scale(r.i16(fc + 0x1e), r.u16(fc + 0x22));
  if (mm !== 0x64 && mm !== 0x66)
    return imageOf({ src: null, kind: "WMF" }, "Picture", width, height);
  let at = fc + cbHeader;
  // MM_SHAPEFILE: a linked picture, named by its path.
  const path = mm === 0x66 ? decode(data.subarray(at + 1, at + 1 + r.u8(at)), "windows-1252") : "";
  if (mm === 0x66) at += 1 + r.u8(at);
  const recs = records(r, at, end);
  const shape = recs.find((rec) => rec.type === 0xf004);
  const props = shape ? shapeProps(r, records(r, shape.body, shape.end)) : {};
  /** @type {Blip[]} */
  const blips = [];
  for (const rec of recs) {
    if (rec.type === 0xf007) {
      const name = r.u8(rec.body + 33);
      const inner = record(r, rec.body + 36 + name);
      if (inner.end <= rec.end) blips.push(blipOf(data, inner));
    } else if (rec.type >= 0xf018 && rec.type <= 0xf117) blips.push(blipOf(data, rec));
  }
  const alt = props.description || props.name;
  if (blips[0]) return imageOf(blips[0], alt || "Picture", width, height);
  // No BLIP: a linked picture, or a drawing (a rule, WordArt, a shape) kept as its frame.
  const linked = path.split(/[\\/]/).pop();
  if (linked) return imageOf({ src: null, kind: "linked" }, alt || linked, width, height);
  return imageOf({ src: null, kind: "drawing" }, alt || "Drawing", width, height);
}
