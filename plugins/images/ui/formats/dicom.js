// DICOM: the first frame of uncompressed images (implicit and explicit VR, little and big endian,
// and the deflated syntax), 8- or 16-bit monochrome through the rescale and the file's window, and
// 8-bit RGB or YBR. Encapsulated JPEG baseline goes to the webview; other compressions open the
// details view. Patient data is never read into the details.
import { ascii, fail, inflate, reader } from "../bytes.js";
import { canvasFor, enough, range } from "./pixels.js";

const LONG_VR = new Set([
  "OB",
  "OD",
  "OF",
  "OL",
  "OV",
  "OW",
  "SQ",
  "SV",
  "UC",
  "UN",
  "UR",
  "UT",
  "UV",
]);
const SYNTAXES = /** @type {Record<string, string>} */ ({
  "1.2.840.10008.1.2.4.57": "JPEG Lossless",
  "1.2.840.10008.1.2.4.70": "JPEG Lossless",
  "1.2.840.10008.1.2.4.80": "JPEG-LS",
  "1.2.840.10008.1.2.4.81": "JPEG-LS",
  "1.2.840.10008.1.2.4.90": "JPEG 2000",
  "1.2.840.10008.1.2.4.91": "JPEG 2000",
  "1.2.840.10008.1.2.5": "RLE",
});
const WANTED = new Set([
  0x00080060, 0x00280002, 0x00280004, 0x00280006, 0x00280008, 0x00280010, 0x00280011, 0x00280100,
  0x00280101, 0x00280103, 0x00281050, 0x00281051, 0x00281052, 0x00281053,
]);

/**
 * The elements of a data set, as tag -> [start, length]; pixel data stops the walk.
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {{ explicit: boolean, le: boolean }} syntax
 */
function elements(bytes, start, { explicit, le }) {
  const r = reader(bytes, le);
  /** @type {Map<number, { at: number, length: number, vr: string }>} */
  const found = new Map();
  let at = start;
  /** Skip an item or sequence of undefined length up to its delimiter. */
  const skipUndefined = () => {
    let depth = 1;
    while (at + 8 <= bytes.length && depth > 0) {
      const tag = r.u16(at) * 65536 + r.u16(at + 2);
      const length = r.u32(at + 4);
      at += 8;
      if (tag === 0xfffee0dd || tag === 0xfffee00d) depth--;
      else if (tag === 0xfffee000) {
        if (length === 0xffffffff) depth++;
        else at += length;
      } else {
        // An element inside an item: re-read it with its VR.
        at -= 8;
        const inner = element();
        if (inner.undefined) depth++;
      }
    }
  };
  const element = () => {
    const tag = r.u16(at) * 65536 + r.u16(at + 2);
    let vr = "";
    let length;
    if (explicit && tag >>> 16 !== 0xfffe) {
      vr = ascii(bytes, at + 4, 2);
      if (LONG_VR.has(vr)) {
        length = r.u32(at + 8);
        at += 12;
      } else {
        length = r.u16(at + 6);
        at += 8;
      }
    } else {
      length = r.u32(at + 4);
      at += 8;
    }
    const undefinedLength = length === 0xffffffff;
    return { tag, vr, length, undefined: undefinedLength, at };
  };
  while (at + 8 <= bytes.length) {
    const e = element();
    if (e.tag === 0x7fe00010) {
      found.set(e.tag, { at: e.at, length: e.length, vr: e.vr });
      break;
    }
    if (e.undefined) {
      skipUndefined();
      continue;
    }
    if (WANTED.has(e.tag)) found.set(e.tag, { at: e.at, length: e.length, vr: e.vr });
    at += e.length;
  }
  return found;
}

/** @returns {Promise<import("./pixels.js").Pixels | import("./pixels.js").Web>} */
export async function decodeDicom(/** @type {Uint8Array} */ input) {
  let bytes = input;
  let start = ascii(bytes, 128, 4) === "DICM" ? 132 : 0;
  let syntax = "1.2.840.10008.1.2";
  if (start === 132) {
    const m = reader(bytes);
    // The meta group's length says where the data set begins; its transfer syntax, how it is coded.
    for (let at = 132; at + 8 < bytes.length; ) {
      const group = m.u16(at);
      if (group !== 2) {
        start = at;
        break;
      }
      const vr = ascii(bytes, at + 4, 2);
      const long = LONG_VR.has(vr);
      const length = long ? m.u32(at + 8) : m.u16(at + 6);
      const body = at + (long ? 12 : 8);
      if (m.u16(at + 2) === 0x0010) syntax = ascii(bytes, body, length).replace(/[\0 ]+$/, "");
      at = body + length;
    }
  } else if (/^[A-Z]{2}$/.test(ascii(bytes, 4, 2))) syntax = "1.2.840.10008.1.2.1";
  if (SYNTAXES[syntax])
    fail(`Its pixels are compressed with ${SYNTAXES[syntax]}, which Images does not read.`);
  if (syntax === "1.2.840.10008.1.2.1.99") {
    bytes = new Uint8Array([
      ...bytes.subarray(0, start),
      ...(await inflate(bytes.subarray(start), "deflate-raw")),
    ]);
  }
  const le = syntax !== "1.2.840.10008.1.2.2";
  const explicit = syntax !== "1.2.840.10008.1.2";
  const found = elements(bytes, start, { explicit, le });
  const r = reader(bytes, le);
  const text = (/** @type {number} */ tag) => {
    const e = found.get(tag);
    return e
      ? ascii(bytes, e.at, e.length)
          .replace(/[\0 ]+$/, "")
          .trim()
      : undefined;
  };
  const us = (/** @type {number} */ tag) => {
    const e = found.get(tag);
    return e && e.length >= 2 ? r.u16(e.at) : undefined;
  };
  const num = (/** @type {number} */ tag) => {
    const v = Number.parseFloat(text(tag)?.split("\\")[0] ?? "");
    return Number.isFinite(v) ? v : undefined;
  };
  const pixel = found.get(0x7fe00010) ?? fail("It holds no image.");
  const [rows, columns] = [us(0x00280010) ?? 0, us(0x00280011) ?? 0];
  const samples = us(0x00280002) ?? 1;
  const allocated = us(0x00280100) ?? 16;
  const stored = us(0x00280101) ?? allocated;
  const signed = us(0x00280103) === 1;
  const photometric = text(0x00280004) ?? "MONOCHROME2";
  const frames = num(0x00280008) ?? 1;
  const details = [
    { label: "Modality", value: text(0x00080060) ?? "" },
    { label: "Bits", value: `${stored} of ${allocated}${signed ? ", signed" : ""}` },
    ...(frames > 1 ? [{ label: "Shown", value: `the first of ${frames} frames` }] : []),
  ].filter((d) => d.value);

  if (pixel.length === 0xffffffff) {
    // Encapsulated: items after the basic offset table; a baseline JPEG goes to the webview.
    if (syntax !== "1.2.840.10008.1.2.4.50" && syntax !== "1.2.840.10008.1.2.4.51")
      fail(`Its pixels use transfer syntax ${syntax}, which Images does not read.`);
    let at = pixel.at;
    const items = [];
    while (at + 8 <= bytes.length && r.u16(at) === 0xfffe && r.u16(at + 2) === 0xe000) {
      const length = r.u32(at + 4);
      items.push(bytes.subarray(at + 8, at + 8 + length));
      at += 8 + length;
    }
    const jpeg = items[1] ?? fail("Its compressed pixels are missing.");
    return { web: { mime: "image/jpeg", data: jpeg, width: columns, height: rows }, rows: details };
  }

  const out = canvasFor(columns, rows);
  const count = rows * columns;
  const step = allocated / 8;
  if (![1, 2].includes(step))
    fail(`It stores ${allocated}-bit samples, which Images does not read.`);
  enough(bytes, pixel.at, count * samples * step);
  if (samples === 3) {
    const planar = us(0x00280006) === 1;
    const ybr = photometric.startsWith("YBR_FULL");
    for (let i = 0; i < count; i++) {
      const s = (/** @type {number} */ c) =>
        bytes[pixel.at + (planar ? c * count + i : i * 3 + c)] ?? 0;
      let [a, b, c] = [s(0), s(1), s(2)];
      if (ybr)
        [a, b, c] = [
          a + 1.402 * (c - 128),
          a - 0.344136 * (b - 128) - 0.714136 * (c - 128),
          a + 1.772 * (b - 128),
        ];
      out.set([a, b, c, 255], i * 4);
    }
    return {
      width: columns,
      height: rows,
      rgba: out,
      depth: `8-bit ${ybr ? "YBR" : "RGB"}`,
      rows: details,
    };
  }
  if (samples !== 1 || !photometric.startsWith("MONOCHROME"))
    fail(`Its pixels are ${photometric}, which Images does not read.`);
  const slope = num(0x00281053) ?? 1;
  const intercept = num(0x00281052) ?? 0;
  const values = new Float64Array(count);
  const shift = 32 - stored;
  for (let i = 0; i < count; i++) {
    let v = step === 1 ? r.u8(pixel.at + i) : r.u16(pixel.at + i * 2);
    v = signed ? (v << shift) >> shift : v & (2 ** stored - 1);
    values[i] = v * slope + intercept;
  }
  let center = num(0x00281050);
  let width = num(0x00281051);
  if (center === undefined || width === undefined || width < 1) {
    const [lo, hi] = range(values);
    center = (lo + hi) / 2 + 0.5;
    width = Math.max(1, hi - lo + 1);
  } else details.push({ label: "Window", value: `${center} / ${width}` });
  const lo = center - 0.5 - (width - 1) / 2;
  const hi = center - 0.5 + (width - 1) / 2;
  const invert = photometric === "MONOCHROME1";
  for (let i = 0; i < count; i++) {
    const v = values[i] ?? 0;
    let g = v <= lo ? 0 : v > hi ? 255 : ((v - (center - 0.5)) / (width - 1) + 0.5) * 255;
    if (invert) g = 255 - g;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return {
    width: columns,
    height: rows,
    rgba: out,
    depth: `${stored}-bit greyscale`,
    rows: details,
  };
}
