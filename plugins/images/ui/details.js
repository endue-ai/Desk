// The details of an image, as label and value rows: format, pixel size, file size, bit depth and
// colour type, frames, what the format adds, and the EXIF fields. Also the model the view draws.
import { sizeText } from "./bytes.js";

/**
 * @typedef {import("./decode.js").Decoded} Decoded
 * @typedef {{ label: string, value: string }} Row
 * @typedef {{ buffer: string, path: string, name: string, size: number, format: string,
 *   kind: "web" | "pixels" | "details", src?: string,
 *   pixels?: { width: number, height: number, data: Uint8ClampedArray },
 *   width?: number, height?: number, orientation: number, label?: string, reason?: string,
 *   slice?: { index: number, count: number }, animated?: boolean, details: Row[] }} ImageModel
 */

/** "1.2 MB (1,234,567 bytes)", or "37 bytes". */
const fileSize = (/** @type {number} */ n) =>
  n < 1024 ? sizeText(n) : `${sizeText(n)} (${n.toLocaleString("en")} bytes)`;

/** @param {Decoded} d @param {number} size @param {{ width?: number, height?: number }} [seen] */
export function rowsOf(d, size, seen = {}) {
  /** @type {Row[]} */
  const rows = [
    { label: "Format", value: d.label ? `${d.format}, ${d.label.toLowerCase()}` : d.format },
  ];
  const width = d.width ?? seen.width;
  const height = d.height ?? seen.height;
  if (width && height) rows.push({ label: "Pixel size", value: `${width} × ${height}` });
  rows.push({ label: "File size", value: fileSize(size) });
  if (d.depth) rows.push({ label: "Colour", value: d.depth });
  if (d.frames && d.frames > 1) rows.push({ label: "Frames", value: String(d.frames) });
  if (d.slices) rows.push({ label: "Slice", value: `${d.slices.index + 1} of ${d.slices.count}` });
  rows.push(...d.rows, ...(d.exif?.fields ?? []));
  return rows;
}

/**
 * What the view shows for one file: an image the webview decodes by its blob: URL (decoding.js).
 * @param {{ buffer: string, path: string, name: string, size: number }} file
 * @param {Decoded} d
 * @returns {ImageModel}
 */
export function modelOf(file, d) {
  const { buffer, path, name, size } = file;
  /** @type {ImageModel} */
  const model = {
    buffer,
    path,
    name,
    size,
    format: d.format,
    kind: d.kind,
    orientation: d.orientation,
    details: rowsOf(d, size),
  };
  if (d.width) model.width = d.width;
  if (d.height) model.height = d.height;
  if (d.label) model.label = d.label;
  if (d.animated) model.animated = true;
  if (d.kind === "details") model.reason = d.reason ?? "Images cannot show it.";
  if (d.kind === "web" && d.url) model.src = d.url;
  if (d.kind === "pixels" && d.rgba && d.width && d.height) {
    model.pixels = { width: d.width, height: d.height, data: d.rgba };
    if (d.slices) model.slice = { index: d.slices.index, count: d.slices.count };
  }
  return model;
}
