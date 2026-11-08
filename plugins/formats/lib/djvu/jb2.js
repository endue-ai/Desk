// JB2, DjVu's bitonal codec (DjVu v3 specification, appendix 2): Sjbz masks and Djbz shared shape
// dictionaries. Records add shapes to a library and place them on the page, either coded
// directly, refined from a library shape, or copied; positions are relative to the text line.

import { checkEnd, decodeDirect, decodeRefined, trim } from "./jb2-bitmap.js";
import { decodeNumber, NumberContext } from "./jb2-number.js";
import { ZPDecoder } from "./zp.js";

/**
 * @typedef {import("./jb2-bitmap.js").Bitmap} Bitmap
 * @typedef {{ shape: number, left: number, top: number }} Blit  the shape's top-left corner, 0-based
 *   from the image's top-left; it may lie partly outside the image
 * @typedef {{ width: number, height: number, shapes: Bitmap[], blits: Blit[], library: number[] }} JB2Image
 *   `library` holds indices into `shapes`, in library order; blits are in the order they were placed
 */

const LARGEST = 262142;
const MOST_PIXELS = 1 << 26;
const MOST_IMAGE = 100_000_000;
const MOST_RECORDS = 1 << 22;

const START = 0;
const NEW_IMAGE_LIBRARY = 1;
const NEW_LIBRARY = 2;
const NEW_IMAGE = 3;
const REFINE_IMAGE_LIBRARY = 4;
const REFINE_LIBRARY = 5;
const REFINE_IMAGE = 6;
const COPY = 7;
const NON_SYMBOL = 8;
const DICTIONARY_OR_RESET = 9;
const COMMENT = 10;
const END = 11;

/**
 * Decodes JB2 data: an Sjbz chunk (a page mask) or a Djbz chunk (a shared dictionary, with no
 * size and no blits). `dictionary` is the decoded Djbz a page's REQUIRED_DICT record asks for.
 * @param {Uint8Array} bytes
 * @param {{ dictionary?: JB2Image | null, pace?: import("./pace.js").Pacer }} [options]
 * @returns {Promise<JB2Image>}
 */
export async function decodeJB2(bytes, { dictionary = null, pace } = {}) {
  pace?.check();
  const zp = new ZPDecoder(bytes);
  const n = {
    type: new NumberContext(),
    size: new NumberContext(),
    index: new NumberContext(),
    width: new NumberContext(),
    height: new NumberContext(),
    widthDiff: new NumberContext(),
    heightDiff: new NumberContext(),
    column: new NumberContext(),
    row: new NumberContext(),
    sameColumn: new NumberContext(),
    sameRow: new NumberContext(),
    newColumn: new NumberContext(),
    newRow: new NumberContext(),
    commentLength: new NumberContext(),
    commentOctet: new NumberContext(),
    dictionarySize: new NumberContext(),
  };
  const direct = new Uint8Array(1024);
  const refined = new Uint8Array(2048);
  const offsetType = new Uint8Array(1);
  const refinementFlag = new Uint8Array(1);
  const num = (
    /** @type {NumberContext} */ tree,
    /** @type {number} */ low,
    /** @type {number} */ high,
  ) => decodeNumber(zp, tree, low, high);
  /** A broken stream: past its end it is cut short, before that it is damaged. */
  const fail = (/** @type {string} */ reason) =>
    new Error(zp.past > 0 ? "The JB2 data is cut short." : `The JB2 data is damaged: ${reason}.`);

  /** @type {JB2Image} */
  const image = { width: 0, height: 0, shapes: [], blits: [], library: [] };
  let started = false;
  // The text line, in the specification's coordinates: columns from 1 at the left, rows from 1
  // at the bottom. Before the first symbol, the line's first symbol sits left of column 1 with
  // its bottom on the top row.
  const line = { left: 0, bottom: 0, right: 0, bottoms: /** @type {number[]} */ ([]) };

  const size = (/** @type {number} */ width, /** @type {number} */ height) => {
    if (width * height > MOST_PIXELS) throw fail("a shape is too large");
  };
  const libraryShape = (/** @type {number} */ index) => image.shapes[image.library[index]];
  const matchIndex = () => {
    if (image.library.length === 0) {
      throw fail("it refers to a shape before any is defined");
    }
    return num(n.index, 0, image.library.length - 1);
  };

  /** Where a symbol of this size goes, relative to the line; updates the line. */
  const place = (/** @type {number} */ width, /** @type {number} */ height) => {
    let left;
    let top;
    if (zp.decode(offsetType, 0)) {
      left = line.left + num(n.newColumn, -LARGEST - 1, LARGEST);
      top = line.bottom + num(n.newRow, -LARGEST - 1, LARGEST);
      const bottom = top - height + 1;
      line.left = left;
      line.bottom = bottom;
      line.bottoms = [bottom];
    } else {
      left = line.right + num(n.sameColumn, -LARGEST - 1, LARGEST);
      const bottoms = line.bottoms;
      const baseline = bottoms.length >= 3 ? median(bottoms) : line.bottom;
      const bottom = baseline + num(n.sameRow, -LARGEST - 1, LARGEST);
      top = bottom + height - 1;
      bottoms.push(bottom);
      if (bottoms.length > 3) bottoms.shift();
    }
    line.right = left + width - 1;
    return { left, top };
  };

  /** Keeps a decoded bitmap: in the library, on the page, or both. */
  const keep = (
    /** @type {Bitmap} */ bitmap,
    /** @type {boolean} */ toLibrary,
    /** @type {{ left: number, top: number } | null} */ at,
  ) => {
    const trimmed = trim(bitmap);
    const index = image.shapes.length;
    image.shapes.push(trimmed.bitmap);
    if (toLibrary) image.library.push(index);
    if (at) {
      image.blits.push({
        shape: index,
        left: at.left - 1 + trimmed.left,
        top: image.height - at.top + trimmed.top,
      });
    }
  };

  for (let records = 0; ; records++) {
    if (records > MOST_RECORDS) throw fail("it never ends");
    if (pace?.due()) await pace.rest();
    checkEnd(zp);
    const type = num(n.type, 0, 11);
    if (!started && type !== START && type !== DICTIONARY_OR_RESET && type !== COMMENT) {
      throw fail("it does not start with an image size");
    }
    switch (type) {
      case START: {
        if (started) throw fail("it has two image sizes");
        image.width = num(n.size, 0, LARGEST);
        image.height = num(n.size, 0, LARGEST);
        if (image.width * image.height > MOST_IMAGE) {
          throw fail("its image is too large");
        }
        zp.decode(refinementFlag, 0);
        line.bottom = image.height;
        started = true;
        break;
      }
      case NEW_IMAGE_LIBRARY:
      case NEW_LIBRARY:
      case NEW_IMAGE: {
        const width = num(n.width, 0, LARGEST);
        const height = num(n.height, 0, LARGEST);
        size(width, height);
        const bitmap = await decodeDirect(zp, direct, width, height, pace);
        const at = type === NEW_LIBRARY ? null : place(width, height);
        keep(bitmap, type !== NEW_IMAGE, at);
        break;
      }
      case REFINE_IMAGE_LIBRARY:
      case REFINE_LIBRARY:
      case REFINE_IMAGE: {
        const reference = libraryShape(matchIndex());
        const width = reference.width + num(n.widthDiff, -LARGEST - 1, LARGEST);
        const height = reference.height + num(n.heightDiff, -LARGEST - 1, LARGEST);
        if (width < 0 || height < 0) throw fail("a shape has a negative size");
        size(width, height);
        const bitmap = await decodeRefined(zp, refined, width, height, reference, pace);
        const at = type === REFINE_LIBRARY ? null : place(width, height);
        keep(bitmap, type !== REFINE_IMAGE, at);
        break;
      }
      case COPY: {
        const index = image.library[matchIndex()];
        const shape = image.shapes[index];
        const at = place(shape.width, shape.height);
        image.blits.push({ shape: index, left: at.left - 1, top: image.height - at.top });
        break;
      }
      case NON_SYMBOL: {
        const width = num(n.width, 0, LARGEST);
        const height = num(n.height, 0, LARGEST);
        size(width, height);
        const bitmap = await decodeDirect(zp, direct, width, height, pace);
        const left = num(n.column, 1, Math.max(1, image.width));
        const top = num(n.row, 1, Math.max(1, image.height));
        keep(bitmap, false, { left, top });
        break;
      }
      case DICTIONARY_OR_RESET: {
        if (started) {
          for (const tree of Object.values(n)) tree.reset();
          break;
        }
        const count = num(n.dictionarySize, 0, LARGEST);
        if (!dictionary || dictionary.library.length < count) {
          throw new Error("The JB2 data needs a shape dictionary that is missing or too small.");
        }
        for (let i = 0; i < count; i++) {
          image.library.push(image.shapes.length);
          image.shapes.push(dictionary.shapes[dictionary.library[i]]);
        }
        break;
      }
      case COMMENT: {
        const length = num(n.commentLength, 0, LARGEST);
        for (let i = 0; i < length; i++) num(n.commentOctet, 0, 255);
        break;
      }
      case END:
        return image;
    }
  }
}

/** The median of three numbers. @param {number[]} values */
function median([a, b, c]) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/**
 * The image's blits painted on white, as one bitmap the size of the image.
 * @param {JB2Image} image @returns {Bitmap}
 */
export function maskOf(image) {
  const { width, height } = image;
  const bits = new Uint8Array(width * height);
  for (const blit of image.blits) {
    const shape = image.shapes[blit.shape];
    const x0 = Math.max(0, blit.left);
    const x1 = Math.min(width, blit.left + shape.width);
    if (x0 >= x1) continue;
    for (let sy = 0; sy < shape.height; sy++) {
      const y = blit.top + sy;
      if (y < 0 || y >= height) continue;
      const from = sy * shape.width - blit.left;
      const to = y * width;
      for (let x = x0; x < x1; x++) bits[to + x] |= shape.bits[from + x];
    }
  }
  return { width, height, bits };
}
