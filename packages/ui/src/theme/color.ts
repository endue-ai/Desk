/**
 * Colours for the theme gate: parse CSS colours (#hex, rgb(), hsl(), oklch()), move between sRGB and
 * OKLCH, composite a translucent colour over a ground and measure WCAG contrast. DOM-free.
 */

/** sRGB channels 0–255 and alpha 0–1. */
export type Rgba = [number, number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A CSS colour as Rgba, or undefined when it is not one this module reads. */
export function parseColor(input: string): Rgba | undefined {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const byte = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return [byte(0), byte(2), byte(4), full.length === 8 ? byte(6) / 255 : 1];
  }
  const fn = /^(rgba?|hsla?|oklch)\(([^)]*)\)$/.exec(s);
  if (!fn) return undefined;
  const parts = (fn[2] ?? "").split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const num = (t: string | undefined, scale: number) => {
    if (t === undefined) return Number.NaN;
    return t.endsWith("%") ? (Number.parseFloat(t) / 100) * scale : Number.parseFloat(t);
  };
  const alpha = parts[3] === undefined ? 1 : clamp(num(parts[3], 1), 0, 1);
  let rgb: [number, number, number];
  if (fn[1]?.startsWith("rgb")) {
    rgb = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
  } else if (fn[1]?.startsWith("hsl")) {
    rgb = hslToRgb(num(parts[0], 360), num(parts[1], 1), num(parts[2], 1));
  } else {
    rgb = fromOklch(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 360));
  }
  if ([...rgb, alpha].some((v) => !Number.isFinite(v))) return undefined;
  return [clamp(rgb[0], 0, 255), clamp(rgb[1], 0, 255), clamp(rgb[2], 0, 255), alpha];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

/** #rrggbb when opaque, rgba() otherwise. */
export function formatColor([r, g, b, a]: Rgba): string {
  const byte = (v: number) => Math.round(clamp(v, 0, 255));
  if (a >= 1) return `#${[r, g, b].map((v) => byte(v).toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${Math.round(a * 1000) / 1000})`;
}

/** Paint `top` over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

const toLinear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

export function luminance([r, g, b]: Rgba): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast of `fg` (painted over `bg` when translucent) on an opaque `bg`. */
export function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(fg[3] < 1 ? over(fg, bg) : fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** sRGB (0–255) to OKLCH: lightness 0–1, chroma, hue in degrees. */
export function toOklch([r, g, b]: Rgba): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(B, A) * 180) / Math.PI;
  return [L, Math.hypot(A, B), hue < 0 ? hue + 360 : hue];
}

function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to sRGB (0–255), lowering chroma until the colour fits in sRGB, so the hue stays. */
export function fromOklch(L: number, C: number, H: number): [number, number, number] {
  let chroma = Math.max(0, C);
  for (let i = 0; i < 24; i++) {
    const lin = oklchToLinear(clamp(L, 0, 1), chroma, H);
    if (lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4) || chroma < 1e-4) {
      return lin.map((v) => fromLinear(clamp(v, 0, 1))) as [number, number, number];
    }
    chroma *= 0.8;
  }
  return oklchToLinear(clamp(L, 0, 1), 0, H).map((v) => fromLinear(clamp(v, 0, 1))) as [
    number,
    number,
    number,
  ];
}
