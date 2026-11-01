// One page: its INFO, the chunks it holds or includes, its layers decoded and composed, then turned
// as INFO says and corrected for the gamma it was made for. DjVu v3 specification, 7.1 and 8.3.

import { compose } from "./compose.js";
import { chunksIn, dataOf, u16 } from "./iff.js";
import { IW44Image } from "./iw44.js";
import { decodeJB2 } from "./jb2.js";
import { pacer } from "./pace.js";
import { palette as readPalette } from "./text.js";

/**
 * @typedef {{ kind: string, bytes: Uint8Array }} Form  a FORM's secondary id and bytes from "FORM"
 * @typedef {{ width: number, height: number, dpi: number, rotation: number, gamma: number }} Info
 * `rotation` in degrees clockwise (0, 90, 180, 270); `gamma` as INFO gives it (2.2 by default)
 * @typedef {{ include(id: string): Promise<Form>, dictionaries: Map<string, Promise<any>> }} Context
 * @typedef {{ id: string, data: Uint8Array, from: string, cut: boolean }} Part
 * `from`: the INCL id the chunk came through, or ""; `cut`: the file ends inside the chunk
 */

const ROTATIONS = /** @type {Record<number, number>} */ ({ 1: 0, 5: 90, 2: 180, 6: 270 });

/** The INFO chunk's fields (8.3.11); missing fields take their defaults. @param {Uint8Array} d */
export function parseInfo(d) {
  if (d.length < 4) throw new Error("A page's INFO chunk is cut short.");
  const width = u16(d, 0);
  const height = u16(d, 2);
  const dpi = d.length >= 8 ? d[6] | (d[7] << 8) : 300;
  const gamma = d.length >= 9 && d[8] >= 3 && d[8] <= 50 ? d[8] / 10 : 2.2;
  const rotation = d.length >= 10 ? (ROTATIONS[d[9] & 7] ?? 0) : 0;
  return { width, height, dpi: dpi >= 25 && dpi <= 6000 ? dpi : 300, rotation, gamma };
}

/**
 * The page facts of a page FORM: INFO for FORM:DJVU, the IW44 header for FORM:PM44 and BM44.
 * @param {Form} form @returns {Info}
 */
export function pageInfo(form) {
  for (const chunk of chunksIn(form.bytes, 12)) {
    const data = dataOf(form.bytes, chunk);
    if (form.kind === "DJVU" && chunk.id === "INFO") return parseInfo(data);
    if ((form.kind === "PM44" || form.kind === "BM44") && chunk.id === form.kind) {
      if (data.length < 9 || data[0] !== 0) break;
      return { width: u16(data, 4), height: u16(data, 6), dpi: 100, rotation: 0, gamma: 2.2 };
    }
  }
  throw new Error("A page has no INFO chunk, so its size is unknown.");
}

/**
 * The chunks a page holds, with those of the files it includes (INCL) in their place. An
 * included file that cannot be read (an indirect document's file not opened) is left out and
 * named in `missing`.
 * @param {Form} form @param {Context} context
 * @returns {Promise<Part[] & { missing: string[] }>}
 */
export async function pageChunks(form, context) {
  /** @type {Part[] & { missing: string[] }} */
  const out = Object.assign([], { missing: /** @type {string[]} */ ([]) });
  const seen = new Set();
  const walk = async (
    /** @type {Form} */ f,
    /** @type {string} */ from,
    /** @type {number} */ depth,
  ) => {
    for (const chunk of chunksIn(f.bytes, 12)) {
      const data = dataOf(f.bytes, chunk);
      if (chunk.id !== "INCL") {
        out.push({ id: chunk.id, data, from, cut: chunk.cut === true });
        continue;
      }
      const id = new TextDecoder().decode(data).replace(/[\0\s]+$/, "");
      if (seen.has(id) || depth > 8) continue;
      seen.add(id);
      let included;
      try {
        included = await context.include(id);
      } catch {
        out.missing.push(id);
        continue;
      }
      await walk(included, id, depth + 1);
    }
  };
  await walk(form, "", 0);
  return out;
}

/**
 * Renders a page FORM at `scale` (0 < scale <= 1): the composed page, turned as INFO says.
 * @param {Form} form @param {Context} context
 * @param {{ scale?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ width: number, height: number, rgba: Uint8Array, note?: string }>}
 */
export async function renderForm(form, context, { scale = 1, signal } = {}) {
  const pace = pacer(signal);
  pace.check();
  const info = pageInfo(form);
  const { width, height } = info;
  if (!width || !height) throw new Error("The page has no pixels: its INFO gives a size of 0.");
  const s = Math.min(1, Math.max(Number.isFinite(scale) && scale > 0 ? scale : 1, 1 / width));
  const outWidth = Math.max(1, Math.round(width * s));
  const outHeight = Math.max(1, Math.round(height * s));
  const chunks = await pageChunks(form, context);
  const notes = new Set();
  const first = (/** @type {string} */ id) => chunks.find((c) => c.id === id);

  let mask = null;
  const sjbz = first("Sjbz");
  if (sjbz?.cut) notes.add("Its data is cut short, so it shows less than it should.");
  if (sjbz) {
    const djbz = first("Djbz");
    let dictionary = null;
    if (djbz) {
      const key = djbz.from || `page:${form.bytes.byteOffset}`;
      if (!context.dictionaries.has(key)) {
        const decoding = decodeJB2(djbz.data, { pace });
        decoding.catch(() => context.dictionaries.delete(key));
        context.dictionaries.set(key, decoding);
      }
      dictionary = await context.dictionaries.get(key);
    }
    try {
      mask = await decodeJB2(sjbz.data, { dictionary, pace });
    } catch (error) {
      if (!dictionary && chunks.missing.length && /dictionary/.test(String(error))) {
        throw new Error(`The page's shapes are in ${chunks.missing[0]}, which was not opened.`);
      }
      throw error;
    }
  } else if (first("Smmr")) notes.add("Its mask is in Fax G4 (Smmr), which is not decoded here.");

  const layer = async (/** @type {string[]} */ ids, /** @type {boolean} */ fit) => {
    // A layer cut short by the end of the file shows the chunks that arrived whole.
    const all = chunks.filter((c) => ids.includes(c.id));
    const parts = all.filter((c) => !c.cut);
    if (parts.length < all.length)
      notes.add("Its data is cut short, so it shows less than it should.");
    if (!parts.length) return null;
    const image = new IW44Image();
    for (const part of parts) await image.decodeChunk(part.data, pace);
    const red = layerRed(width, height, image.width, image.height);
    // A layer pixel at subsample f covers red * f page pixels; the output needs 1 / s of them.
    let subsample = 1;
    while (fit && subsample < 16 && red * subsample * 2 * s <= 1) subsample *= 2;
    const raster = await image.render({ subsample, pace });
    return { ...raster, red: red * subsample };
  };
  const iw = form.kind === "PM44" || form.kind === "BM44" ? [form.kind] : ["BG44"];
  const background = await layer(iw, true);
  if (!background && first("BGjp"))
    notes.add("Its background is JPEG (BGjp), which is not decoded here.");
  const fgbz = first("FGbz");
  const colours = mask && fgbz ? readPalette(fgbz.data) : null;
  const foreground = mask && !colours ? await layer(["FG44"], false) : null;
  if (mask && !colours && !foreground && first("FGjp")) {
    notes.add(
      "Its foreground colours are JPEG (FGjp), which is not decoded here; the text is black.",
    );
  }

  let raster = await compose({
    width,
    height,
    outWidth,
    outHeight,
    mask,
    background,
    foreground,
    palette: colours,
    pace,
  });
  if (Math.abs(info.gamma - 2.2) > 0.05) gammaCorrect(raster.rgba, info.gamma);
  if (info.rotation) raster = rotate(raster, info.rotation);
  return notes.size ? { ...raster, note: [...notes].join(" ") } : raster;
}

/**
 * How many page pixels one layer pixel covers: the integer subsampling (1 to 12) whose rounded-up
 * quotient gives the layer's size, else the plain ratio.
 * @param {number} width @param {number} height @param {number} w @param {number} h
 */
function layerRed(width, height, w, h) {
  for (let red = 1; red <= 12; red++) {
    if (Math.ceil(width / red) === w && Math.ceil(height / red) === h) return red;
  }
  return Math.max(width / w, height / h);
}

/**
 * Corrects colours made for a display of gamma `gamma` to one of gamma 2.2.
 * @param {Uint8Array} rgba @param {number} gamma
 */
function gammaCorrect(rgba, gamma) {
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) table[v] = Math.round(255 * (v / 255) ** (gamma / 2.2));
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = table[rgba[i]];
    rgba[i + 1] = table[rgba[i + 1]];
    rgba[i + 2] = table[rgba[i + 2]];
  }
}

/**
 * The raster turned clockwise by `degrees` (90, 180 or 270).
 * @param {{ width: number, height: number, rgba: Uint8Array }} raster @param {number} degrees
 */
export function rotate(raster, degrees) {
  const { width, height, rgba } = raster;
  const quarter = degrees === 90 || degrees === 270;
  const w = quarter ? height : width;
  const h = quarter ? width : height;
  const out = new Uint8Array(rgba.length);
  const src = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const dst = new Uint32Array(out.buffer, 0, w * h);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let tx = x;
      let ty = y;
      if (degrees === 90) [tx, ty] = [height - 1 - y, x];
      else if (degrees === 180) [tx, ty] = [width - 1 - x, height - 1 - y];
      else if (degrees === 270) [tx, ty] = [y, width - 1 - x];
      dst[ty * w + tx] = src[y * width + x];
    }
  }
  return { width: w, height: h, rgba: out };
}
