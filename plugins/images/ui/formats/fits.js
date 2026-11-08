// FITS: the primary image (or, when the primary HDU is empty, the first IMAGE extension), BITPIX
// 8, 16, 32, 64, -32 and -64 through BZERO and BSCALE, min-max stretched. FITS stores the bottom
// row first; the image is shown the right way up.
import { ascii, fail, reader } from "../bytes.js";
import { canvasFor, enough, range, stretch } from "./pixels.js";

/** One header: its keywords and where its data starts. */
function header(/** @type {Uint8Array} */ bytes, /** @type {number} */ start) {
  /** @type {Map<string, string>} */
  const cards = new Map();
  for (let at = start; at + 80 <= bytes.length; at += 80) {
    const card = ascii(bytes, at, 80);
    const key = card.slice(0, 8).trim();
    if (key === "END") return { cards, data: Math.ceil((at + 80 - start) / 2880) * 2880 + start };
    if (card[8] === "=")
      cards.set(
        key,
        card
          .slice(10)
          .replace(/\/.*$/, "")
          .trim()
          .replace(/^'(.*)'$/, "$1")
          .trim(),
      );
  }
  return fail("Its header has no END.");
}

/** @returns {import("./pixels.js").Pixels} */
export function decodeFits(/** @type {Uint8Array} */ bytes) {
  let start = 0;
  for (let hdu = 0; hdu < 16 && start < bytes.length; hdu++) {
    const { cards, data } = header(bytes, start);
    const int = (/** @type {string} */ k) => Number.parseInt(cards.get(k) ?? "", 10);
    const bitpix = int("BITPIX");
    const naxis = int("NAXIS") || 0;
    const axes = Array.from({ length: naxis }, (_, i) => int(`NAXIS${i + 1}`) || 0);
    const size = (Math.abs(bitpix) / 8) * axes.reduce((n, a) => n * a, naxis ? 1 : 0);
    const kind = hdu === 0 ? "" : (cards.get("XTENSION") ?? "");
    if ((hdu === 0 || kind === "IMAGE") && naxis >= 2 && (axes[0] ?? 0) > 0 && (axes[1] ?? 0) > 0)
      return image(bytes, data, cards, bitpix, axes, hdu);
    if (kind === "BINTABLE" && cards.get("ZIMAGE") === "T")
      fail("Its image is tile-compressed, which Images does not read.");
    start = data + Math.ceil(size / 2880) * 2880 + (int("PCOUNT") || 0);
  }
  return fail("It holds no 2-D image.");
}

function image(
  /** @type {Uint8Array} */ bytes,
  /** @type {number} */ data,
  /** @type {Map<string, string>} */ cards,
  /** @type {number} */ bitpix,
  /** @type {number[]} */ axes,
  /** @type {number} */ hdu,
) {
  const [width = 0, height = 0] = axes;
  const out = canvasFor(width, height);
  const step = Math.abs(bitpix) / 8;
  if (![8, 16, 32, 64, -32, -64].includes(bitpix))
    fail(`Its BITPIX is ${bitpix}, which FITS does not define.`);
  const count = width * height;
  enough(bytes, data, count * step);
  const r = reader(bytes, false);
  const zero = Number.parseFloat(cards.get("BZERO") ?? "0") || 0;
  const scale = Number.parseFloat(cards.get("BSCALE") ?? "1") || 1;
  const blank = cards.has("BLANK") ? Number.parseInt(cards.get("BLANK") ?? "", 10) : undefined;
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const at = data + i * step;
    let v;
    if (bitpix === 8) v = r.u8(at);
    else if (bitpix === 16) v = r.i16(at);
    else if (bitpix === 32) v = r.i32(at);
    else if (bitpix === 64) v = Number(r.view.getBigInt64(at, false));
    else if (bitpix === -32) v = r.f32(at);
    else v = r.f64(at);
    values[i] = bitpix > 0 && v === blank ? Number.NaN : zero + scale * v;
  }
  const [lo, hi] = range(values);
  stretch(values, lo, hi, out, (i) => (height - 1 - Math.floor(i / width)) * width + (i % width));
  const rows = [
    { label: "BITPIX", value: String(bitpix) },
    { label: "Range", value: `${Number(lo.toPrecision(6))} to ${Number(hi.toPrecision(6))}` },
    ...["OBJECT", "TELESCOP", "INSTRUME"].flatMap((k) =>
      cards.get(k) ? [{ label: k[0] + k.slice(1).toLowerCase(), value: cards.get(k) ?? "" }] : [],
    ),
    ...(axes.length > 2
      ? [
          {
            label: "Shown",
            value: `the first plane of ${axes.slice(2).reduce((n, a) => n * a, 1)}`,
          },
        ]
      : []),
    ...(hdu > 0 ? [{ label: "HDU", value: `extension ${hdu}` }] : []),
  ];
  return {
    width,
    height,
    rgba: out,
    depth: `${bitpix < 0 ? "float" : "integer"} (BITPIX ${bitpix}), stretched`,
    rows,
  };
}
