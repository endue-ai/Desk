/**
 * WCAG contrast for the token checks: parse #hex, rgb(a) and oklch(), composite translucent colours,
 * and compute the ratio. Used by the token unit test and the Playwright contrast check.
 */

export type RGBA = [number, number, number, number];

function oklchToRgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  }) as [number, number, number];
}

export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex = s.length === 4 ? [...s.slice(1)].map((c) => c + c).join("") : s.slice(1);
    const n = Number.parseInt(hex.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const nums = (s.match(/-?[\d.]+%?/g) ?? []).map((t) =>
    t.endsWith("%") ? Number.parseFloat(t) / 100 : Number.parseFloat(t),
  );
  if (s.startsWith("oklch")) {
    const [l = 0, c = 0, h = 0, alpha = 1] = nums;
    return [...oklchToRgb(l, c, h), alpha];
  }
  if (s.startsWith("rgb")) {
    const [r = 0, g = 0, b = 0, alpha = 1] = nums;
    return [r, g, b, alpha];
  }
  if (s === "transparent") return [0, 0, 0, 0];
  throw new Error(`unknown colour ${input}`);
}

/** Paint `top` over `bottom` (bottom opaque). */
export function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: RGBA): number {
  const ch = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(fg: RGBA, bg: RGBA): number {
  const opaqueFg = fg[3] < 1 ? over(fg, bg) : fg;
  const a = luminance(opaqueFg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
