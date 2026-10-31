// The viewer's state without the DOM: zoom (fit or a scale), pan, a quarter-turn rotation and a
// mirror, for the view only. The view measures; this keeps the numbers and writes the transform.

/** The scales Mod+= and Mod+- step through. */
export const STEPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const MIN = 0.01;
const MAX = 64;
/** How far an arrow key pans, in pixels. */
export const PAN = 40;

/**
 * An EXIF orientation as what the view does to the stored pixels: mirror first, then turn.
 * @param {number} orientation 1 to 8
 */
export function fromOrientation(orientation) {
  const table = /** @type {Record<number, [number, boolean]>} */ ({
    2: [0, true],
    3: [180, false],
    4: [180, true],
    5: [270, true],
    6: [90, false],
    7: [90, true],
    8: [270, false],
  });
  const [rotation, flipped] = table[orientation] ?? [0, false];
  return { rotation, flipped };
}

/** @typedef {{ width: number, height: number }} Size */

/** A size turned a quarter (or three quarters) round. */
export const turned = (/** @type {Size} */ size, /** @type {number} */ rotation) =>
  rotation % 180 ? { width: size.height, height: size.width } : size;

/** The scale that fits `size` into `pane`, never above 1. */
export const fitOf = (/** @type {Size} */ pane, /** @type {Size} */ size) =>
  size.width > 0 && size.height > 0 && pane.width > 0 && pane.height > 0
    ? Math.min(1, pane.width / size.width, pane.height / size.height)
    : 1;

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  Math.min(hi, Math.max(lo, v));
const num = (/** @type {number} */ v, /** @type {number} */ digits) =>
  String(Number(v.toFixed(digits)));

/** The CSS transform for one pane. */
export const transform = (
  /** @type {{ x: number, y: number }} */ pan,
  /** @type {number} */ scale,
  /** @type {{ rotation: number, flipped: boolean }} */ turn,
) =>
  `translate(${num(pan.x, 2)}px, ${num(pan.y, 2)}px) rotate(${turn.rotation}deg) ` +
  `scale(${num(turn.flipped ? -scale : scale, 4)}, ${num(scale, 4)})`;

export function createViewer() {
  return {
    /** @type {"fit" | number} */
    zoom: /** @type {"fit" | number} */ ("fit"),
    x: 0,
    y: 0,
    rotation: 0,
    flipped: false,
    /** Start over for a new image: fit, centred, turned as its orientation says. */
    reset(orientation = 1) {
      Object.assign(this, { zoom: "fit", x: 0, y: 0 }, fromOrientation(orientation));
    },
    /** The scale in force, given the scale that fits. */
    scale(/** @type {number} */ fit) {
      return this.zoom === "fit" ? fit : this.zoom;
    },
    /** Set a scale, keeping the point at the centre where it was. */
    set(/** @type {number} */ next, /** @type {number} */ fit) {
      const before = this.scale(fit);
      const after = clamp(next, MIN, MAX);
      this.x *= after / before;
      this.y *= after / before;
      this.zoom = after;
    },
    /** The next step up (1) or down (-1) from the scale in force. */
    step(/** @type {1 | -1} */ direction, /** @type {number} */ fit) {
      const now = this.scale(fit);
      const next =
        direction > 0
          ? (STEPS.find((s) => s > now + 1e-6) ?? MAX)
          : ([...STEPS].reverse().find((s) => s < now - 1e-6) ?? MIN);
      this.set(next, fit);
    },
    fit() {
      Object.assign(this, { zoom: "fit", x: 0, y: 0 });
    },
    /** Zoom by `factor` around `point`, relative to the pane's centre: that point stays put. */
    zoomAt(
      /** @type {number} */ factor,
      /** @type {{ x: number, y: number }} */ point,
      /** @type {number} */ fit,
    ) {
      const before = this.scale(fit);
      const after = clamp(before * factor, MIN, MAX);
      this.x = point.x - ((point.x - this.x) * after) / before;
      this.y = point.y - ((point.y - this.y) * after) / before;
      this.zoom = after;
    },
    pan(/** @type {number} */ dx, /** @type {number} */ dy) {
      this.x += dx;
      this.y += dy;
    },
    /** Keep the image from leaving the pane: `limits` are how far each way it may move. */
    clamp(/** @type {{ x: number, y: number }} */ limits) {
      this.x = clamp(this.x, -limits.x, limits.x);
      this.y = clamp(this.y, -limits.y, limits.y);
    },
    /** A quarter turn: 90 clockwise, -90 anticlockwise. */
    rotate(/** @type {number} */ degrees) {
      this.rotation = (((this.rotation + degrees) % 360) + 360) % 360;
    },
    /** Mirror left to right as the image is seen now. */
    flip() {
      this.rotation = (360 - this.rotation) % 360;
      this.flipped = !this.flipped;
    },
  };
}
