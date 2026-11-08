/**
 * Where arranged windows go (ADR 0116): a grid that fills an area, a cascade down from its top
 * left, and the spread's curved, layered fan (or a flat grid when motion is reduced). Pure over
 * rects and counts, so the commands, the overlay and the tests need no DOM, and the same count in
 * the same area always gives the same places.
 */
import { freeArea, freeTop, MIN, type Rect } from "../surface/geometry";
import { CASCADE, GAP } from "../surface/tiling";

/** The cell shape a grid aims for: windows on a desk read best a little wider than tall. */
export const TARGET_ASPECT = 4 / 3;

/**
 * What arranging fills: the app between the side bars and above the bottom line, and under Eris
 * while she sits in her default place at the top (the area plugin windows open in, ADR 0040).
 */
export function arrangeArea(vw: number, vh: number, belowEris = true): Rect {
  return freeArea(vw, vh, freeTop(belowEris));
}

/** How many windows each row of a `cols` wide grid of `n` holds: full rows, then the rest. */
export function rowSizes(n: number, cols: number): number[] {
  const rows: number[] = [];
  for (let left = n; left > 0; left -= cols) rows.push(Math.min(cols, left));
  return rows;
}

/**
 * The columns and rows for `n` windows in `area`: the shape whose cells come closest to
 * TARGET_ASPECT, a short last row costing a little, so the count follows both the number of
 * windows and the area's aspect (2×2 for four on a wide screen, 3 + 2 for five, 4 × 3 for twelve).
 */
export function gridShape(n: number, area: Rect, gap = GAP): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: n === 1 ? 1 : 0 };
  let best = { cols: 1, rows: n, score: Number.POSITIVE_INFINITY };
  for (let cols = 1; cols <= n; cols++) {
    const sizes = rowSizes(n, cols);
    const h = (area.h - gap * (sizes.length - 1)) / sizes.length;
    let off = 0;
    for (const k of sizes) {
      const w = (area.w - gap * (k - 1)) / k;
      off += k * Math.abs(Math.log(w / h / TARGET_ASPECT));
    }
    const empty = cols * sizes.length - n;
    const score = off / n + (0.25 * empty) / cols;
    if (score < best.score - 1e-9) best = { cols, rows: sizes.length, score };
  }
  return { cols: best.cols, rows: best.rows };
}

/** Cell `i` of `count` across `size` from `from`, `gap` apart: integer edges, the last one flush. */
function span(from: number, size: number, count: number, gap: number, i: number) {
  const start = from + Math.round((i * (size + gap)) / count);
  const end = from + Math.round(((i + 1) * (size + gap)) / count) - gap;
  return { start, size: end - start };
}

/**
 * The tile grid: rows top to bottom, windows left to right in each; a shorter last row stretches
 * across the width, so the cells and the gaps between them fill `area` exactly and never overlap.
 */
export function tileRects(n: number, area: Rect, gap = GAP): Rect[] {
  const { cols } = gridShape(n, area, gap);
  const sizes = rowSizes(n, cols);
  return sizes.flatMap((k, row) => {
    const y = span(area.y, area.h, sizes.length, gap, row);
    return Array.from({ length: k }, (_, i) => {
      const x = span(area.x, area.w, k, gap, i);
      return { x: x.start, y: y.start, w: x.size, h: y.size };
    });
  });
}

/** The size every cascaded window takes in `area`: most of it, never under the minimum. */
export function cascadeSize(area: Rect): { w: number; h: number } {
  return {
    w: Math.min(area.w, Math.max(MIN.w, Math.round(area.w * 0.6))),
    h: Math.min(area.h, Math.max(MIN.h, Math.round(area.h * 0.65))),
  };
}

/**
 * The cascade: one size for all, each window `step` down and right of the one before from the
 * area's top left. When the next step would leave the area, a new run starts at the top, moved
 * right by the run before's width, so no title bar ever hides exactly under another.
 */
export function cascadeRects(n: number, area: Rect, step = CASCADE): Rect[] {
  const { w, h } = cascadeSize(area);
  const room = Math.min(area.w - w, area.h - h);
  const perRun = Math.max(1, Math.floor(room / step) + 1);
  const shift = Math.max(0, area.w - w - (perRun - 1) * step);
  return Array.from({ length: n }, (_, i) => {
    const run = Math.floor(i / perRun);
    const k = i % perRun;
    const x = area.x + Math.min(run * perRun * step, shift) + k * step;
    return { x, y: area.y + k * step, w, h };
  });
}

/** One place in the spread: a box the window is fitted into, and how it sits in depth. */
export interface Slot extends Rect {
  /** Towards the viewer in pixels (negative: further back). */
  z: number;
  /** Degrees about the vertical axis: the fan turns each card towards the middle. */
  rotateY: number;
  /** Degrees about the horizontal axis: rows further back lean back. */
  rotateX: number;
  /** Row from the top (0: the back row). */
  row: number;
  /** Position in its row from the left. */
  col: number;
  /** Paint order: front rows above back rows, the middle of a row above its ends. */
  order: number;
}

/** Room the spread keeps around its cards: the filter at the top, a margin elsewhere. */
export const SPREAD_INSET = { top: 128, right: 72, bottom: 72, left: 72 };
/** How far back each row behind the front one sits, and how far the fan turns its outer cards. */
export const DEPTH = 160;
export const TURN = 14;
const GAP_X = 32;
const GAP_Y = 40;

/** The stage the spread lays its cards on, for an app `vw`×`vh`. */
export function spreadStage(vw: number, vh: number): Rect {
  const i = SPREAD_INSET;
  return {
    x: i.left,
    y: i.top,
    w: Math.max(MIN.w, vw - i.left - i.right),
    h: Math.max(MIN.h, vh - i.top - i.bottom),
  };
}

/** At most this many cards in a row of the fan. */
const MOST = 7;
/** The window shape the fan sizes its boxes for. */
const CARD_ASPECT = 1.4;

/** `n` cards in `rows` balanced rows, back row first, the back rows taking the extra. */
function balanced(n: number, rows: number): number[] {
  const base = Math.floor(n / rows);
  return Array.from({ length: rows }, (_, r) => base + (r < n % rows ? 1 : 0));
}

/** The width of a card box in a row of `k` that is `rowH` tall. */
const boxWidth = (stage: Rect, k: number, rowH: number) =>
  Math.min((stage.w - GAP_X * (k - 1)) / k, rowH * 1.6);

/**
 * Rows of the fan for `n` cards, back row first: the count whose smallest card comes out largest,
 * each further row costing a quarter, so a few windows make one wide fan and many make layers.
 */
export function fanRows(n: number, stage: Rect): number[] {
  if (n <= 0) return [];
  let best = { sizes: [n], score: -1 };
  for (let rows = Math.ceil(n / MOST); rows <= n; rows++) {
    const sizes = balanced(n, rows);
    const rowH = (stage.h - GAP_Y * (rows - 1)) / rows;
    const smallest = Math.min(
      ...sizes.map((k) => {
        const w = Math.min(boxWidth(stage, k, rowH), rowH * CARD_ASPECT);
        return (w * w) / CARD_ASPECT;
      }),
    );
    const score = smallest * 0.75 ** (rows - 1);
    if (score > best.score + 1e-9) best = { sizes, score };
  }
  return best.sizes;
}

/**
 * The spread's places for `n` windows on `stage`, back row first and each row left to right. The
 * fan curves: the outer cards of a row dip a little, turn towards the middle and come a little
 * forward; rows further back sit higher, deeper and lean back. `flat` (reduced motion) lays the
 * same boxes out as a plain grid: no turn, no depth.
 */
export function spreadSlots(n: number, stage: Rect, flat = false): Slot[] {
  if (flat) return flatSlots(n, stage);
  const rows = fanRows(n, stage);
  const rowH = (stage.h - GAP_Y * (rows.length - 1)) / Math.max(1, rows.length);
  return rows.flatMap((k, row) => {
    const w = boxWidth(stage, k, rowH);
    const left = stage.x + (stage.w - (k * w + (k - 1) * GAP_X)) / 2;
    const back = rows.length - 1 - row;
    return Array.from({ length: k }, (_, col) => {
      const t = k > 1 ? (col - (k - 1) / 2) / ((k - 1) / 2) : 0;
      return {
        x: round(left + col * (w + GAP_X)),
        y: round(stage.y + row * (rowH + GAP_Y) + t * t * rowH * 0.08),
        w: round(w),
        h: round(rowH),
        z: round(-back * DEPTH + t * t * 32),
        rotateY: round(-t * TURN),
        rotateX: back * 3,
        row,
        col,
        order: (row + 1) * 100 - Math.round(Math.abs(t) * 10),
      };
    });
  });
}

/** The reduced-motion spread: the stage as a grid of equal boxes, a short last row centred. */
export function flatSlots(n: number, stage: Rect): Slot[] {
  const gap = 24;
  const { cols } = gridShape(n, stage, gap);
  const sizes = rowSizes(n, cols);
  const w = (stage.w - gap * (cols - 1)) / cols;
  const h = (stage.h - gap * (sizes.length - 1)) / Math.max(1, sizes.length);
  return sizes.flatMap((k, row) => {
    const left = stage.x + (stage.w - (k * w + (k - 1) * gap)) / 2;
    return Array.from({ length: k }, (_, col) => ({
      x: round(left + col * (w + gap)),
      y: round(stage.y + row * (h + gap)),
      w: round(w),
      h: round(h),
      z: 0,
      rotateY: 0,
      rotateX: 0,
      row,
      col,
      order: 1,
    }));
  });
}

/** Two decimals: deterministic numbers in transforms and snapshots. */
const round = (v: number) => Math.round(v * 100) / 100;
