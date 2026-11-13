// The motion gate's analysis (`just perf-motion`, #247, ADR 0208): what a shake did, read from the
// shell's frame trace (`DESK_FRAME_TRACE`, apps/desk/shell/src/frame_trace.rs) and from the frames it
// read back, judged against the limits in e2e/perf/motion.json. Pure: motion.test.ts.
import type { Image } from "../../support/png.ts";
import { percentile, round1 } from "./stats.ts";

/** One line of the trace: milliseconds since it opened, the event and its fields. */
export interface Line {
  t: number;
  e: string;
  // biome-ignore lint/suspicious/noExplicitAny: each event has fields of its own
  f: any;
}

/** A rect in the window's logical pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The trace's lines, skipping a torn last one (a desk killed mid-write). */
export function parseTrace(text: string): Line[] {
  const lines: Line[] = [];
  for (const row of text.split("\n")) {
    if (!row.trim()) continue;
    try {
      lines.push(JSON.parse(row) as Line);
    } catch {
      // A line cut short ends the trace.
    }
  }
  return lines;
}

/** One shake's phases in the trace, by its tag. */
export interface Shake {
  tag: string;
  pressed: number;
  swing: [number, number];
  released: number;
  done: number;
  /** The lines from its press to its end. */
  lines: Line[];
}

/** The shakes in `lines` that ran to their end. */
export function shakes(lines: readonly Line[]): Shake[] {
  const found: Shake[] = [];
  let open: { tag: string; at: number; i: number; on?: number; off?: number; rel?: number } | null =
    null;
  lines.forEach((line, i) => {
    if (line.e !== "shake") return;
    const f = line.f as { phase?: string; tag?: string | null; on?: boolean };
    if (f.phase === "press") open = { tag: f.tag ?? "", at: line.t, i };
    else if (!open) return;
    else if (f.phase === "swing" && f.on) open.on = line.t;
    else if (f.phase === "swing") open.off = line.t;
    else if (f.phase === "release") open.rel = line.t;
    else if (f.phase === "done" && open.on !== undefined && open.off !== undefined) {
      found.push({
        tag: open.tag,
        pressed: open.at,
        swing: [open.on, open.off],
        released: open.rel ?? open.off,
        done: line.t,
        lines: lines.slice(open.i, i + 1),
      });
      open = null;
    }
  });
  return found;
}

/** Frames while a window swings: how many, how evenly, and where a frame's time went. */
export interface Timing {
  seconds: number;
  frames: number;
  fps: number;
  /** Frames composed and not presented (rendered unseen, or withheld by the OS). */
  unseen: number;
  intervals: { p50: number; p95: number; max: number };
  /** Intervals longer than the limit, and their share of all. */
  long: number;
  longShare: number;
  tickP95: number;
  sceneP95: number;
  movesPerSecond: number;
  /** Copies of the surfaces' paints, and the slowest. */
  attaches: number;
  copyP95: number;
}

const p = (values: number[], q: number) => (values.length ? round1(percentile(values, q)) : 0);

/** The swing's frames: in `screen` mode only frames shown in the window count. */
export function timing(shake: Shake, longMs: number, screen: boolean): Timing {
  const [from, to] = shake.swing;
  const inside = shake.lines.filter((l) => l.t >= from && l.t <= to);
  const all = inside.filter((l) => l.e === "frame");
  const frames = screen ? all.filter((l) => l.f.shown) : all;
  const gaps = frames.slice(1).map((l, i) => l.t - (frames[i] as Line).t);
  const seconds = (to - from) / 1000;
  const long = gaps.filter((g) => g > longMs).length;
  const attaches = inside.filter((l) => l.e === "attach");
  return {
    seconds: round1(seconds),
    frames: frames.length,
    fps: round1(frames.length / seconds),
    unseen: all.filter((l) => !l.f.shown).length,
    intervals: { p50: p(gaps, 0.5), p95: p(gaps, 0.95), max: round1(Math.max(0, ...gaps)) },
    long,
    longShare: gaps.length ? long / gaps.length : 1,
    tickP95: p(
      all.map((l) => l.f.tickMs as number),
      0.95,
    ),
    sceneP95: p(
      all.map((l) => l.f.sceneMs as number),
      0.95,
    ),
    movesPerSecond: round1(inside.filter((l) => l.e === "move").length / seconds),
    attaches: attaches.length,
    copyP95: p(
      attaches.map((l) => l.f.copyMs as number),
      0.95,
    ),
  };
}

/** Where window `id` was drawn in a captured frame, and from what. */
export interface Drawn {
  tag: string;
  path: string;
  at: number;
  rect: Rect;
  /** Drawn from its own page (ADR 0201), or from `parts` cut from the desk's page. */
  own: boolean;
  parts: number;
  /** Where the desk's system layer lay over every window (its bars, the map): not the window's. */
  over: Rect[];
}

/** Each frame the shake read back, with where window `id` was drawn in it: the scene laid out last
 * before the capture's line (the capture lays it out). */
export function captured(shake: Shake, id: string): Drawn[] {
  const out: Drawn[] = [];
  let laid: Line | undefined;
  for (const line of shake.lines) {
    if (line.e === "win") laid = line;
    if (line.e !== "capture" || !line.f.ok || !laid) continue;
    const w = (
      laid.f.windows as { id: string; rect: number[]; own: boolean; parts: number }[]
    ).find((w) => w.id === id);
    if (!w) continue;
    const [x = 0, y = 0, width = 0, h = 0] = w.rect;
    const over = ((laid.f.over ?? []) as number[][]).map(([x = 0, y = 0, w = 0, h = 0]) => ({
      x,
      y,
      w,
      h,
    }));
    out.push({
      tag: line.f.tag,
      path: line.f.path,
      at: line.t,
      rect: { x, y, w: width, h },
      own: w.own,
      parts: w.parts,
      over,
    });
  }
  return out;
}

/** How far a window's pixels in `b` at `rb` stray from its own in `a` at `ra`. */
export interface Strayed {
  blocks: number;
  differing: number;
  /** The largest difference of a block's mean colour, 0 to 255. */
  worst: number;
}

/**
 * The window inside `ra` of `a` against inside `rb` of `b` (same size, logical pixels), in blocks of
 * `block` device pixels: a block differs when its mean colour moved by more than `tolerance` on a
 * channel. Means over blocks forgive a picture drawn half a pixel off (a window in motion is drawn at
 * fractional places until #250); another window's pixels or the desk under it do not. `inset` leaves
 * out the edges, where the frame, the corners and the shadow meet what lies around, and `cover` the
 * blocks that lie under what is drawn over every window in `a` or in `b` (the desk's bars, #258).
 */
export function strayed(
  a: Image,
  ra: Rect,
  b: Image,
  rb: Rect,
  opts = STRAY,
  cover: { a?: readonly Rect[]; b?: readonly Rect[] } = {},
): Strayed {
  const { block, tolerance, inset } = opts;
  const s = a.scale;
  const ax = Math.round((ra.x + inset) * s);
  const ay = Math.round((ra.y + inset) * s);
  const bx = Math.round((rb.x + inset) * b.scale);
  const by = Math.round((rb.y + inset) * b.scale);
  const w = Math.floor((Math.min(ra.w, rb.w) - 2 * inset) * s);
  const h = Math.floor((Math.min(ra.h, rb.h) - 2 * inset) * s);
  let blocks = 0;
  let differing = 0;
  let worst = 0;
  const under = (rs: readonly Rect[] | undefined, x: number, y: number, k: number) =>
    !!rs?.some(
      (r) =>
        x < (r.x + r.w) * k && x + block > r.x * k && y < (r.y + r.h) * k && y + block > r.y * k,
    );
  for (let y = 0; y + block <= h; y += block) {
    for (let x = 0; x + block <= w; x += block) {
      if (under(cover.a, ax + x, ay + y, s) || under(cover.b, bx + x, by + y, b.scale)) continue;
      const ma = mean(a, ax + x, ay + y, block);
      const mb = mean(b, bx + x, by + y, block);
      if (!ma || !mb) continue;
      blocks++;
      const d = Math.max(...ma.map((v, i) => Math.abs(v - (mb[i] ?? 0))));
      worst = Math.max(worst, d);
      if (d > tolerance) differing++;
    }
  }
  return { blocks, differing, worst: round1(worst) };
}

/** Blocks of 8 device pixels, a mean moved by 24 of 255, 6 logical pixels in from the edges. */
export const STRAY = { block: 8, tolerance: 24, inset: 6 };

function mean(img: Image, x0: number, y0: number, n: number): number[] | undefined {
  if (x0 < 0 || y0 < 0 || x0 + n > img.width || y0 + n > img.height) return undefined;
  const sum = [0, 0, 0];
  for (let y = y0; y < y0 + n; y++) {
    for (let x = x0; x < x0 + n; x++) {
      const o = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (img.data[o + c] ?? 0);
    }
  }
  return sum.map((v) => v / (n * n));
}

/**
 * How sharp the window inside `r` is: the mean step in brightness between neighbouring device
 * pixels, across and down, `inset` logical pixels in from the edges. A picture drawn at a fractional
 * place is blended between pixels, and its steps are smaller.
 */
export function sharpness(img: Image, r: Rect, inset = STRAY.inset): number {
  const s = img.scale;
  const x0 = Math.max(0, Math.round((r.x + inset) * s));
  const y0 = Math.max(0, Math.round((r.y + inset) * s));
  const x1 = Math.min(img.width - 1, x0 + Math.floor((r.w - 2 * inset) * s));
  const y1 = Math.min(img.height - 1, y0 + Math.floor((r.h - 2 * inset) * s));
  const luma = (x: number, y: number) => {
    const o = (y * img.width + x) * 4;
    return (
      0.299 * (img.data[o] ?? 0) + 0.587 * (img.data[o + 1] ?? 0) + 0.114 * (img.data[o + 2] ?? 0)
    );
  };
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const here = luma(x, y);
      sum += Math.abs(luma(x + 1, y) - here) + Math.abs(luma(x, y + 1) - here);
      n += 2;
    }
  }
  return n ? sum / n : 0;
}
