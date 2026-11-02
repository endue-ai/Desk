// OpenEXR scanline files: uncompressed, RLE, ZIPS and ZIP; HALF, FLOAT and UINT channels; R, G, B
// and A, or Y alone. To float, then tone-mapped. Tiled, deep and multi-part files and the other
// compressions (PIZ, PXR24, B44, DWA) open the details view with that reason.
import { ascii, fail, inflate, reader } from "../bytes.js";
import { canvasFor, enough } from "./pixels.js";
import { toneMap } from "./tonemap.js";

const COMPRESSIONS = [
  "none",
  "RLE",
  "ZIPS",
  "ZIP",
  "PIZ",
  "PXR24",
  "B44",
  "B44A",
  "DWAA",
  "DWAB",
  "HTJ2K",
];
const LINES = [1, 1, 1, 16];

/** IEEE half to float. */
export function half(/** @type {number} */ h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 31;
  const m = h & 1023;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? Number.NaN : s * Number.POSITIVE_INFINITY;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** Every half as a float, built on first use. */
/** @type {Float32Array | null} */
let halves = null;
const halfTable = () => {
  if (halves) return halves;
  halves = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) halves[h] = half(h);
  return halves;
};

/** The header's attributes, by name, as [type, start, size]; and where the offset table starts. */
function attributes(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes);
  /** @type {Map<string, { type: string, at: number, size: number }>} */
  const found = new Map();
  let at = 8;
  const cstring = () => {
    const end = bytes.indexOf(0, at);
    if (end < 0 || end - at > 255) fail("Its header is damaged.");
    const text = ascii(bytes, at, end - at);
    at = end + 1;
    return text;
  };
  for (;;) {
    const name = cstring();
    if (name === "") break;
    const type = cstring();
    const size = r.u32(at);
    found.set(name, { type, at: at + 4, size });
    at += 4 + size;
    if (at > bytes.length) fail("Its header is damaged.");
  }
  return { found, end: at };
}

/** RLE as OpenEXR writes it: a negative count is that many literal bytes, else count + 1 repeats. */
function unRle(/** @type {Uint8Array} */ data, /** @type {number} */ size) {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < data.length && o < size; ) {
    const n = ((data[i++] ?? 0) << 24) >> 24;
    if (n < 0) {
      out.set(data.subarray(i, i - n), o);
      o -= n;
      i -= n;
    } else {
      out.fill(data[i++] ?? 0, o, o + n + 1);
      o += n + 1;
    }
  }
  return out;
}

/** Undo the predictor and the byte interleave that RLE and ZIP apply before compressing. */
function unPredict(/** @type {Uint8Array} */ t) {
  let previous = t[0] ?? 0;
  for (let i = 1; i < t.length; i++) {
    previous = (previous + /** @type {number} */ (t[i]) - 128) & 255;
    t[i] = previous;
  }
  const out = new Uint8Array(t.length);
  const mid = (t.length + 1) >> 1;
  for (let i = 0, a = 0, b = mid; i < t.length; i += 2) {
    out[i] = /** @type {number} */ (t[a++]);
    if (i + 1 < t.length) out[i + 1] = /** @type {number} */ (t[b++]);
  }
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @param {{ progress?: (done: number, total: number) => void }} [options] rows decoded of all
 * @returns {Promise<import("./pixels.js").Pixels>}
 */
export async function decodeExr(bytes, options = {}) {
  const r = reader(bytes);
  const flags = r.u32(4);
  if (flags & 0x200) fail("It is a tiled OpenEXR; Images reads scanline files.");
  if (flags & 0x800) fail("It is a deep OpenEXR; Images reads flat images.");
  if (flags & 0x1000) fail("It is a multi-part OpenEXR; Images reads single-part files.");
  const { found, end } = attributes(bytes);
  const attr = (/** @type {string} */ name) =>
    found.get(name) ?? fail(`Its header has no ${name}.`);
  const compression = r.u8(attr("compression").at);
  if (compression > 3)
    fail(
      `It uses ${COMPRESSIONS[compression] ?? "an unknown"} compression, which Images does not read.`,
    );
  const box = attr("dataWindow").at;
  const [xMin, yMin, xMax, yMax] = [r.i32(box), r.i32(box + 4), r.i32(box + 8), r.i32(box + 12)];
  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;
  canvasFor(width, height);

  const list = attr("channels");
  /** @type {Array<{ name: string, type: number, bytes: number, sampled: boolean }>} */
  const channels = [];
  for (let at = list.at; at < list.at + list.size - 1; ) {
    const stop = bytes.indexOf(0, at);
    const name = ascii(bytes, at, stop - at);
    const type = r.i32(stop + 1);
    const sampled = r.i32(stop + 9) === 1 && r.i32(stop + 13) === 1;
    channels.push({ name, type, bytes: type === 1 ? 2 : 4, sampled });
    at = stop + 17;
  }
  const bytesPerLine = channels.reduce((n, c) => n + c.bytes * width, 0);
  const pick = (/** @type {string} */ want) =>
    channels.findIndex((c) => c.sampled && (c.name === want || c.name.endsWith(`.${want}`)));
  let [ri, gi, bi, ai] = ["R", "G", "B", "A"].map(pick);
  if (ri < 0 && gi < 0 && bi < 0) {
    const y = pick("Y") >= 0 ? pick("Y") : channels.findIndex((c) => c.sampled);
    if (y < 0) fail("It has no channel Images can show.");
    ri = gi = bi = y;
  }

  const table = halfTable();
  /** Which RGBA slots each channel fills. */
  const targetsOf = channels.map((_, index) =>
    [ri, gi, bi, ai].flatMap((t, k) => (t === index ? [k] : [])),
  );
  const lines = LINES[compression] ?? 1;
  const chunks = Math.ceil(height / lines);
  const float = new Float32Array(width * height * 4);
  for (let i = 3; i < float.length; i += 4) float[i] = 1;
  enough(bytes, end, chunks * 8);
  // About a hundred reports over the file, and the last.
  const every = Math.max(1, Math.floor(chunks / 100));
  let done = 0;
  for (let c = 0; c < chunks; c++) {
    const offset = r.u64(end + c * 8);
    const y0 = r.i32(offset) - yMin;
    const size = r.i32(offset + 4);
    enough(bytes, offset + 8, size);
    const rows = Math.min(lines, height - y0);
    const expected = bytesPerLine * rows;
    let data = bytes.subarray(offset + 8, offset + 8 + size);
    if (size < expected && compression === 1) data = unPredict(unRle(data, expected));
    else if (size < expected && compression >= 2) data = unPredict(await inflate(data, "deflate"));
    if (data.length < expected) fail("A block of its pixels is damaged.");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let row = 0; row < rows; row++) {
      const y = y0 + row;
      if (y < 0 || y >= height) continue;
      let at = row * bytesPerLine;
      for (let ci = 0; ci < channels.length; ci++) {
        const channel = channels[ci];
        const targets = targetsOf[ci] ?? [];
        if (!channel) continue;
        if (targets.length > 0)
          for (let x = 0, o = y * width * 4; x < width; x++, o += 4) {
            const p = at + x * channel.bytes;
            const v =
              channel.type === 1
                ? (table[view.getUint16(p, true)] ?? 0)
                : channel.type === 2
                  ? view.getFloat32(p, true)
                  : view.getUint32(p, true);
            for (const k of targets) float[o + k] = v;
          }
        at += channel.bytes * width;
      }
    }
    done += rows;
    if (options.progress && ((c + 1) % every === 0 || c === chunks - 1))
      options.progress(Math.min(done, height), height);
  }
  const kinds = [...new Set(channels.map((c) => ["UINT", "HALF", "FLOAT"][c.type] ?? "?"))].join(
    ", ",
  );
  return {
    width,
    height,
    rgba: toneMap(float, width * height),
    float,
    depth: `${kinds}, ${channels.map((c) => c.name).join(" ")}, tone-mapped`,
    rows: [{ label: "Compression", value: COMPRESSIONS[compression] ?? "none" }],
  };
}
