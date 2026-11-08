// Which format a file is: its first bytes first, then its extension for the formats that have no
// magic number (TGA, plain WMF, DICOM without its preamble). A file whose bytes match nothing is
// "unknown", whatever its name says. TIFF-shaped files with a camera's extension are RAW.
import { ascii, extensionOf, has } from "./bytes.js";

/** The name the details view gives each format. */
export const LABELS = /** @type {const} */ ({
  png: "PNG",
  jpeg: "JPEG",
  gif: "GIF",
  webp: "WebP",
  avif: "AVIF",
  heic: "HEIC",
  jxl: "JPEG XL",
  bmp: "BMP",
  tiff: "TIFF",
  ico: "ICO",
  cur: "CUR",
  icns: "ICNS",
  svg: "SVG",
  svgz: "SVGZ",
  tga: "TGA",
  netpbm: "Netpbm",
  qoi: "QOI",
  dds: "DDS",
  hdr: "Radiance HDR",
  exr: "OpenEXR",
  ktx: "KTX",
  eps: "EPS",
  wmf: "WMF",
  emf: "EMF",
  raw: "RAW",
  dicom: "DICOM",
  fits: "FITS",
  nifti: "NIfTI-1",
  unknown: "Unknown",
});

/** @typedef {keyof typeof LABELS} Format */

/** Camera RAW extensions; their files are TIFF-shaped or have their own magic. */
export const RAW = new Set(
  "dng cr2 cr3 crw nef nrw arw srf sr2 orf rw2 raf pef srw 3fr erf kdc mrw".split(" "),
);

/** Formats an extension alone may name, because their files carry no magic number. */
const BY_EXTENSION = /** @type {Record<string, Format>} */ ({
  tga: "tga",
  wmf: "wmf",
  dcm: "dicom",
});

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** The ftyp box's major and compatible brands, or [] when the file does not start with one. */
function brands(/** @type {Uint8Array} */ bytes) {
  if (!has(bytes, 4, "ftyp")) return [];
  const size =
    ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  const list = [ascii(bytes, 8, 4)];
  for (let at = 16; at + 4 <= Math.min(size, bytes.length, 256); at += 4)
    list.push(ascii(bytes, at, 4));
  return list;
}

/** Whether the text at the start of the file is an SVG document. */
function isSvg(/** @type {Uint8Array} */ bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).replace(/^﻿/, "").trimStart();
  if (!head.startsWith("<")) return false;
  return /<svg[\s>]/i.test(head) && /^<(\?xml|!--|!DOCTYPE svg|svg)/i.test(head);
}

/**
 * @param {Uint8Array} bytes
 * @param {string} name the file name or path
 * @returns {Format}
 */
export function sniff(bytes, name) {
  const ext = extensionOf(name);
  const tiffShaped = has(bytes, 0, "II*\0") || has(bytes, 0, "MM\0*");
  if (has(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (has(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (has(bytes, 0, "GIF87a") || has(bytes, 0, "GIF89a")) return "gif";
  if (has(bytes, 0, "RIFF") && has(bytes, 8, "WEBP")) return "webp";
  if (has(bytes, 0, [0xff, 0x0a]) || has(bytes, 4, "JXL \r\n\x87\n")) return "jxl";
  const ftyp = brands(bytes);
  if (ftyp.includes("crx ")) return "raw";
  if (ftyp.includes("avif") || ftyp.includes("avis")) return "avif";
  if (ftyp.some((brand) => HEIF_BRANDS.has(brand))) return "heic";
  if (has(bytes, 0, "FUJIFILMCCD-RAW")) return "raw";
  if (has(bytes, 0, "IIRO") || has(bytes, 0, "IIRS") || has(bytes, 0, "MMOR")) return "raw";
  if (has(bytes, 0, "IIU\0") || has(bytes, 0, "II\x1a\0\0\0HEAPCCDR") || has(bytes, 0, "\0MRM"))
    return "raw";
  if (tiffShaped && (has(bytes, 8, "CR") || RAW.has(ext))) return "raw";
  if (tiffShaped || has(bytes, 0, "II+\0") || has(bytes, 0, "MM\0+")) return "tiff";
  if (has(bytes, 0, "BM") && bytes.length >= 26) return "bmp";
  if (has(bytes, 0, [0, 0, 1, 0]) && (bytes[4] ?? 0) + (bytes[5] ?? 0) > 0) return "ico";
  if (has(bytes, 0, [0, 0, 2, 0]) && (bytes[4] ?? 0) + (bytes[5] ?? 0) > 0) return "cur";
  if (has(bytes, 0, "icns")) return "icns";
  if (has(bytes, 0, "qoif")) return "qoi";
  if (has(bytes, 0, "DDS ")) return "dds";
  if (has(bytes, 0, "#?RADIANCE") || has(bytes, 0, "#?RGBE")) return "hdr";
  if (has(bytes, 0, [0x76, 0x2f, 0x31, 0x01])) return "exr";
  if (has(bytes, 0, [0xab, 0x4b, 0x54, 0x58, 0x20])) return "ktx";
  if (has(bytes, 0, "%!PS") || has(bytes, 0, [0xc5, 0xd0, 0xd3, 0xc6])) return "eps";
  if (has(bytes, 0, [0xd7, 0xcd, 0xc6, 0x9a])) return "wmf";
  if (has(bytes, 0, [1, 0, 0, 0]) && has(bytes, 40, " EMF")) return "emf";
  if (has(bytes, 128, "DICM")) return "dicom";
  if (has(bytes, 0, "SIMPLE  =")) return "fits";
  if (
    (has(bytes, 0, [0x5c, 1, 0, 0]) || has(bytes, 0, [0, 0, 1, 0x5c])) &&
    (has(bytes, 344, "n+1\0") || has(bytes, 344, "ni1\0"))
  )
    return "nifti";
  if (/^P[1-7]\s/.test(ascii(bytes, 0, 3))) return "netpbm";
  if (has(bytes, 0, [0x1f, 0x8b]) && ext === "svgz") return "svgz";
  if (isSvg(bytes)) return "svg";
  if (bytes.length > 0 && BY_EXTENSION[ext]) return BY_EXTENSION[ext];
  return "unknown";
}
