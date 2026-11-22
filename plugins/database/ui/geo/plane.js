// The plain plane a map is drawn on (PG-46), with no tiles: where the view is (its centre, its
// pixels per unit, and how much an x unit is narrowed for degrees, the cosine of the latitude it was
// fitted at), fitting a box, zooming about a point and panning, the units an SRID's coordinates are
// in, the graticule's round step and the scale bar's round length. Pure; both the frame and the
// worker use it.

/**
 * @typedef {{ cx: number, cy: number, scale: number, kx: number }} View
 *   `scale` is pixels per y unit; an x unit is `scale * kx` pixels.
 * @typedef {"degrees" | "mercator" | "metres" | "units"} Units
 * @typedef {import("./geometry.js").Bounds} Bounds
 */

const DEGREES = new Set([4326, 4269, 4258]);
const EARTH = 6378137;
const METRES_PER_DEGREE = 111_320;
export const MIN_SCALE = 1e-12;
export const MAX_SCALE = 1e15;

/** The units of an SRID's coordinates. */
export function unitsOf(/** @type {number} */ srid) {
  if (DEGREES.has(srid)) return /** @type {Units} */ ("degrees");
  if (srid === 3857 || srid === 900913) return /** @type {Units} */ ("mercator");
  if ((srid >= 32601 && srid <= 32660) || (srid >= 32701 && srid <= 32760))
    return /** @type {Units} */ ("metres");
  return /** @type {Units} */ ("units");
}

/** A point of the data on the screen. */
export function toScreen(
  /** @type {View} */ v,
  /** @type {number} */ x,
  /** @type {number} */ y,
  /** @type {number} */ width,
  /** @type {number} */ height,
) {
  return [width / 2 + (x - v.cx) * v.scale * v.kx, height / 2 - (y - v.cy) * v.scale];
}

/** A point of the screen in the data. */
export function toData(
  /** @type {View} */ v,
  /** @type {number} */ sx,
  /** @type {number} */ sy,
  /** @type {number} */ width,
  /** @type {number} */ height,
) {
  return [v.cx + (sx - width / 2) / (v.scale * v.kx), v.cy - (sy - height / 2) / v.scale];
}

/** The view that shows a box whole, `pad` pixels in from each side. */
export function fitView(
  /** @type {Bounds | null} */ bounds,
  /** @type {number} */ width,
  /** @type {number} */ height,
  /** @type {Units} */ units,
  pad = 24,
) {
  if (!bounds) return { cx: 0, cy: 0, scale: 1, kx: 1 };
  const [x0, y0, x1, y1] = bounds;
  const cy = (y0 + y1) / 2;
  const kx = units === "degrees" ? Math.min(1, Math.max(0.05, Math.cos((cy * Math.PI) / 180))) : 1;
  const least = units === "degrees" ? 0.01 : 10;
  const spanX = (x1 - x0) * kx || y1 - y0 || least;
  const spanY = y1 - y0 || spanX;
  const scale = Math.min(
    Math.max(1, width - pad * 2) / spanX,
    Math.max(1, height - pad * 2) / spanY,
  );
  return { cx: (x0 + x1) / 2, cy, scale: clampScale(scale), kx };
}

const clampScale = (/** @type {number} */ s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Zoom by `factor` keeping the data under the screen point (sx, sy) where it is. */
export function zoomAt(
  /** @type {View} */ v,
  /** @type {number} */ factor,
  /** @type {number} */ sx,
  /** @type {number} */ sy,
  /** @type {number} */ width,
  /** @type {number} */ height,
) {
  const [x, y] = toData(v, sx, sy, width, height);
  const scale = clampScale(v.scale * factor);
  return {
    ...v,
    scale,
    cx: x - (sx - width / 2) / (scale * v.kx),
    cy: y + (sy - height / 2) / scale,
  };
}

/** The view moved with the pointer by (dx, dy) pixels. */
export function pan(/** @type {View} */ v, /** @type {number} */ dx, /** @type {number} */ dy) {
  return { ...v, cx: v.cx - dx / (v.scale * v.kx), cy: v.cy + dy / v.scale };
}

/** The largest of 1, 2 and 5 times a power of ten at most `x` (`up`: the smallest at least). */
export function round125(/** @type {number} */ x, up = false) {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const power = 10 ** Math.floor(Math.log10(x));
  const steps = up ? [1, 2, 5, 10] : [10, 5, 2, 1];
  for (const s of steps)
    if (up ? s * power >= x * (1 - 1e-9) : s * power <= x * (1 + 1e-9)) return s * power;
  return power;
}

/** The graticule's step in data units: round, and at least `gap` pixels apart. */
export const gridStep = (/** @type {View} */ v, gap = 80) => round125(gap / v.scale, true);

/** Metres a pixel is at the view's centre, or null when the SRID's units are not known. */
export function metresPerPixel(/** @type {View} */ v, /** @type {Units} */ units) {
  if (units === "degrees") return METRES_PER_DEGREE / v.scale;
  if (units === "mercator") return Math.cos(Math.atan(Math.sinh(v.cy / EARTH))) / v.scale;
  if (units === "metres") return 1 / v.scale;
  return null;
}

/** A value as text with as many decimals as `step` needs. */
export function fixed(/** @type {number} */ value, /** @type {number} */ step) {
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(step) + 1e-9)));
  return (Math.abs(value) < step / 2 ? 0 : value).toFixed(decimals);
}

/** The scale bar: its length in pixels (at most `max`) and what it says (`500 m`, `2 km`, `10 units`). */
export function scaleBar(/** @type {View} */ v, /** @type {Units} */ units, max = 120) {
  const metres = metresPerPixel(v, units);
  const per = metres ?? 1 / v.scale;
  const length = round125(per * max);
  const px = length / per;
  if (metres === null) return { px, label: `${fixed(length, length)} units` };
  return {
    px,
    label:
      length >= 1000 ? `${fixed(length / 1000, length / 1000)} km` : `${fixed(length, length)} m`,
  };
}
