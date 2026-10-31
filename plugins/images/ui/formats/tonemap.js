// Float RGBA (HDR, OpenEXR) to 8-bit sRGB. Extended Reinhard on luminance with the image's own
// white point: an image whose values stay within 1 is only sRGB-encoded, brighter ones roll off
// smoothly instead of clipping.

/** @param {number} c linear, 0 to 1 */
const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB bytes for linear values in 1/65536 steps: a table instead of a power per channel. */
const STEPS = 65536;
/** @type {Uint8Array | null} */
let table = null;
const encode = () => {
  if (table) return table;
  table = new Uint8Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) table[i] = Math.round(srgb(i / STEPS) * 255);
  return table;
};

/**
 * @param {Float32Array} float RGBA, `count` pixels
 * @param {number} count
 * @returns {Uint8ClampedArray}
 */
export function toneMap(float, count) {
  const lut = encode();
  let white = 1;
  for (let i = 0; i < count; i++) {
    const l =
      0.2126 * (float[i * 4] ?? 0) +
      0.7152 * (float[i * 4 + 1] ?? 0) +
      0.0722 * (float[i * 4 + 2] ?? 0);
    if (l > white && l < Number.POSITIVE_INFINITY) white = l;
  }
  const w2 = white * white;
  const out = new Uint8ClampedArray(count * 4);
  const byte = (/** @type {number} */ c) => lut[c >= 1 ? STEPS : c > 0 ? (c * STEPS) | 0 : 0] ?? 0;
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const r = float[p] || 0;
    const g = float[p + 1] || 0;
    const b = float[p + 2] || 0;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const scale = l > 0 && l < Number.POSITIVE_INFINITY ? (1 + l / w2) / (1 + l) : 1;
    out[p] = byte(r * scale);
    out[p + 1] = byte(g * scale);
    out[p + 2] = byte(b * scale);
    const a = float[p + 3];
    out[p + 3] = (a === undefined || Number.isNaN(a) ? 1 : a) * 255;
  }
  return out;
}
