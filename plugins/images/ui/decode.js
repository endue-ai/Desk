// One file's bytes to what the viewer shows: an image the webview decodes (with its header facts
// and EXIF), pixels from the plugin's own decoders, or the details view with one sentence saying
// why. Nothing here throws: a parser error becomes the details view's reason.
import { extensionOf, has, inflate, Unreadable } from "./bytes.js";
import { decodeDds } from "./formats/dds.js";
import { decodeDicom } from "./formats/dicom.js";
import { readExif } from "./formats/exif.js";
import { decodeExr } from "./formats/exr.js";
import { decodeFits } from "./formats/fits.js";
import { decodeHdr } from "./formats/hdr.js";
import { decodeIcns } from "./formats/icns.js";
import { decodeKtx } from "./formats/ktx.js";
import { decodeNetpbm } from "./formats/netpbm.js";
import { decodeNifti } from "./formats/nifti.js";
import { probe } from "./formats/probe.js";
import { decodeQoi } from "./formats/qoi.js";
import { largestJpeg, largestStrips } from "./formats/raw.js";
import { decodeTga } from "./formats/tga.js";
import { decodeEmf, decodeEps, decodeWmf } from "./formats/vector.js";
import { LABELS, sniff } from "./sniff.js";

/**
 * @typedef {import("./formats/pixels.js").Row} Row
 * @typedef {import("./formats/pixels.js").Slices} Slices
 * @typedef {import("./formats/exif.js").Exif} Exif
 * @typedef {{ id: string, format: string, kind: "web" | "pixels" | "details", orientation: number,
 *   mime?: string, data?: Uint8Array, url?: string, width?: number, height?: number,
 *   rgba?: Uint8ClampedArray, float?: Float32Array, slices?: Slices, label?: string,
 *   reason?: string, depth?: string, frames?: number, animated?: boolean, rows: Row[],
 *   exif?: Exif, close?: () => void }} Decoded
 *   url: the blob: URL of `data` once decoding.js made it; close ends a volume's worker.
 * @typedef {{ progress?: (done: number, total: number) => void }} DecodeOptions
 *   progress: rows decoded of all, from the decoders that count them (OpenEXR).
 */

export const MIME = /** @type {Record<string, string>} */ ({
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  jxl: "image/jxl",
  bmp: "image/bmp",
  tiff: "image/tiff",
  ico: "image/x-icon",
  cur: "image/x-icon",
  svg: "image/svg+xml",
});

/** Formats the webview decodes only where the platform's WebKit does. */
const PLATFORM = new Set(["heic", "jxl", "tiff", "avif"]);

/** The orientation the HEIF transforms (irot, imir) give, as an EXIF orientation number. */
const ORIENTATION = /** @type {Record<string, number>} */ ({
  "0f": 1,
  "0t": 2,
  "180f": 3,
  "180t": 4,
  "270t": 5,
  "90f": 6,
  "90t": 7,
  "270f": 8,
});

/** Own decoders, by format. */
const OWN = /** @type {Record<string, (b: Uint8Array, options: DecodeOptions) => unknown>} */ ({
  tga: decodeTga,
  netpbm: decodeNetpbm,
  qoi: decodeQoi,
  dds: decodeDds,
  hdr: decodeHdr,
  exr: decodeExr,
  icns: decodeIcns,
  ktx: decodeKtx,
  dicom: decodeDicom,
  fits: decodeFits,
  nifti: decodeNifti,
  eps: decodeEps,
  wmf: decodeWmf,
  emf: decodeEmf,
});

/** The reason the webview gives when it could not decode a file of `format`. */
export function webviewReason(/** @type {string} */ id, /** @type {string} */ format) {
  return PLATFORM.has(id)
    ? `This system's webview does not decode ${format}.`
    : `The webview could not decode it; the ${format} data may be damaged.`;
}

/**
 * @param {Uint8Array} bytes
 * @param {string} name the file name or path
 * @param {DecodeOptions} [options]
 * @returns {Promise<Decoded>}
 */
export async function decode(bytes, name, options = {}) {
  const id = sniff(bytes, name);
  const ext = extensionOf(name);
  let format = id === "raw" ? `RAW (${ext ? ext.toUpperCase() : "camera"})` : LABELS[id];
  /** @type {Decoded} */
  const base = { id, format, kind: "details", orientation: 1, rows: [] };
  try {
    if (id === "unknown" && has(bytes, 0, [0x1f, 0x8b])) {
      // A gzipped file under an image's name (a .nii that is really .nii.gz, say).
      const inner = await inflate(bytes, "gzip");
      const found = sniff(inner, name.replace(/\.gz$/i, ""));
      if (found !== "unknown")
        return { ...(await decode(inner, name, options)), format: `${LABELS[found]} (gzip)` };
    }
    if (id === "unknown")
      return { ...base, reason: "Its first bytes are not those of any image format Images reads." };
    if (id === "svgz") {
      const svg = await inflate(bytes, "gzip");
      return {
        ...base,
        kind: "web",
        mime: "image/svg+xml",
        data: svg,
        ...probe("svg", svg),
        rows: [],
      };
    }
    if (id === "raw") {
      const jpeg = largestJpeg(bytes);
      const exif = readExif(bytes, id, jpeg?.data);
      const orientation = exif?.orientation ?? 1;
      const strips = largestStrips(bytes);
      const label = "Embedded preview";
      if (strips && (!jpeg || strips.width * strips.height > jpeg.width * jpeg.height))
        return { ...base, kind: "pixels", ...strips, label, exif, orientation, depth: "8-bit RGB" };
      if (!jpeg)
        return {
          ...base,
          exif,
          orientation,
          reason: "It carries no embedded preview that Images can show.",
        };
      const { data, width, height } = jpeg;
      const depth = probe("jpeg", data).depth;
      return {
        ...base,
        kind: "web",
        mime: "image/jpeg",
        data,
        width,
        height,
        label,
        exif,
        orientation,
        depth,
      };
    }
    const mime = MIME[id];
    if (mime) {
      const facts = probe(id, bytes);
      const exif = readExif(bytes, id);
      let orientation = exif?.orientation ?? 1;
      // HEIF's own transforms are the orientation; its EXIF one only repeats them.
      if (id === "heic" || id === "avif")
        orientation = ORIENTATION[`${facts.rotation ?? 0}${facts.flipped ? "t" : "f"}`] ?? 1;
      if (facts.apng) format = "APNG";
      // A CUR is an ICO whose type says cursor; the webview reads it as the icon it is.
      const data = id === "cur" ? Uint8Array.from(bytes, (b, i) => (i === 2 ? 1 : b)) : bytes;
      const { rotation: _r, flipped: _f, apng: _a, ...rest } = facts;
      return { ...base, format, kind: "web", mime, data, ...rest, exif, orientation, rows: [] };
    }
    const decoder = OWN[id];
    if (!decoder) return { ...base, reason: "Images does not read this format." };
    const out = /** @type {Record<string, unknown>} */ (await decoder(bytes, options));
    const rows = /** @type {Row[]} */ (out.rows ?? []);
    const depth = /** @type {string | undefined} */ (out.depth);
    if (out.web) {
      const web =
        /** @type {{ mime: string, data: Uint8Array, width?: number, height?: number, label?: string }} */ (
          out.web
        );
      return { ...base, kind: "web", ...web, rows, depth };
    }
    if (out.rgba) return { ...base, ...out, kind: "pixels", rows, depth, format };
    return { ...base, reason: /** @type {string} */ (out.reason), rows };
  } catch (error) {
    const reason =
      error instanceof Unreadable ? error.message : "It looks damaged: Images could not read it.";
    return { ...base, format, reason };
  }
}
