// Float RGBA (HDR, OpenEXR) to 8-bit sRGB. Extended Reinhard on luminance with the image's own
// white point: an image whose values stay within 1 is only sRGB-encoded, brighter ones roll off
// smoothly instead of clipping.

/** @param {number} c linear, 0 to 1 */
const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * @param {Float32Array} float RGBA, `count` pixels
 * @param {number} count
 * @returns {Uint8ClampedArray}
 */
export function toneMap(float, count) {
  let white = 1;
  for (let i = 0; i < count; i++) {
    const l =
      0.2126 * (float[i * 4] ?? 0) +
      0.7152 * (float[i * 4 + 1] ?? 0) +
      0.0722 * (float[i * 4 + 2] ?? 0);
    if (Number.isFinite(l) && l > white) white = l;
  }
  const w2 = white * white;
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const r = Math.max(0, float[p] || 0);
    const g = Math.max(0, float[p + 1] || 0);
    const b = Math.max(0, float[p + 2] || 0);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const scale = l > 0 && Number.isFinite(l) ? (1 + l / w2) / (1 + l) : 1;
    out[p] = srgb(Math.min(1, r * scale)) * 255;
    out[p + 1] = srgb(Math.min(1, g * scale)) * 255;
    out[p + 2] = srgb(Math.min(1, b * scale)) * 255;
    const a = float[p + 3];
    out[p + 3] = (a === undefined || Number.isNaN(a) ? 1 : Math.min(1, Math.max(0, a))) * 255;
  }
  return out;
}
