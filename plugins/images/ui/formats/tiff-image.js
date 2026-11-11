// TIFF images, which the desk's engine does not decode (ADR XXXX): the uncompressed 8-bit RGB strips
// that raw.js already reads for RAW thumbnails are drawn to a canvas, which covers what `sips` and
// most screenshot tools write; any other TIFF gets the sentence saying what it is.
import { probe } from "./probe.js";
import { largestStrips } from "./raw.js";
import { openTiff } from "./tiff.js";

/** TIFF compression schemes by tag value, as the sentence names them. */
const COMPRESSION = /** @type {Record<number, string>} */ ({
  2: "CCITT",
  3: "CCITT",
  4: "CCITT",
  5: "LZW",
  6: "JPEG",
  7: "JPEG",
  8: "Deflate",
  32773: "PackBits",
  32946: "Deflate",
});

/** What a TIFF Images does not read is: "LZW-compressed", "16-bit greyscale". */
function kindOf(/** @type {Uint8Array} */ bytes) {
  try {
    const compression = openTiff(bytes).chain()[0]?.number(0x103) ?? 1;
    if (compression !== 1) {
      const scheme = COMPRESSION[compression];
      return scheme ? `${scheme}-compressed` : "compressed in another scheme";
    }
  } catch {
    return "not readable";
  }
  return probe("tiff", bytes).depth ?? "laid out otherwise";
}

/**
 * The largest uncompressed 8-bit RGB image in a TIFF as RGBA, or the reason it is not shown.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, rgba: Uint8ClampedArray } | { reason: string }}
 */
export function decodeTiff(bytes) {
  const strips = largestStrips(bytes);
  if (strips) return strips;
  return {
    reason: `This build of the desk shows only uncompressed 8-bit RGB TIFF images; this one is ${kindOf(bytes)}.`,
  };
}
