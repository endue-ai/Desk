/**
 * Sweep (ADR 0296): Cmd+drag (Ctrl+drag off the Mac) on the empty desk draws an area, and the mode
 * in force decides what it does with it. Pan moves the canvas; Arrange lays the windows the area
 * touches out inside it; Ask snaps the area and hands it to Eris with the next line; Select picks
 * the windows it touches, for the selection bar's commands or for Eris. This file is the part
 * without a DOM: the modes, the area, which windows it touches, and how Arrange lays them out.
 */

export type SweepMode = "pan" | "arrange" | "ask" | "select";

/** The modes in the order the bar shows them, with the key (1–4) that picks one while sweeping. */
export const SWEEP_MODES: readonly SweepMode[] = ["pan", "arrange", "ask", "select"];

export const SWEEP_LABELS: Record<SweepMode, string> = {
  pan: "Pan",
  arrange: "Arrange",
  ask: "Ask Eris",
  select: "Select",
};

/** What the next line to Eris carries: a snapshot or a selection, said in words for her brain. */
export interface SweepContext {
  /** What the chip above the talk line says. */
  label: string;
  /** What goes to her brain ahead of the person's line. */
  text: string;
  /** The snapshot, as a data: URL the chip shows, when there is one. */
  image?: string;
  /** Where the snapshot was saved, when it was. */
  path?: string;
}

export interface SweepState {
  mode: SweepMode;
  /** The windows Select picked, by id. */
  selected: string[];
  context: SweepContext | null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The area between two points, whichever way the drag went. */
export function boxBetween(ax: number, ay: number, bx: number, by: number): Box {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Whether two boxes overlap by more than an edge. */
export function touches(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The windows (`id` and box) the area touches, in the order given. */
export function touched<T extends { id: string; box: Box }>(area: Box, windows: readonly T[]): T[] {
  return windows.filter((w) => touches(area, w.box));
}

/** The smallest box that holds every box; none for none. */
export function around(boxes: readonly Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** The smallest window Arrange makes, in CSS pixels. */
export const SMALLEST = { w: 240, h: 160 };
/** The gap Arrange leaves between windows. */
export const GAP = 8;

/**
 * `count` windows laid out in `area`: a grid as near square as the area's shape allows, filled row
 * by row, each cell at least SMALLEST (the grid then grows past the area). Whole pixels.
 */
export function gridIn(area: Box, count: number): Box[] {
  if (count <= 0) return [];
  const aspect = area.w / Math.max(area.h, 1);
  let cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  cols = Math.min(cols, count);
  const rows = Math.ceil(count / cols);
  const w = Math.max(SMALLEST.w, Math.floor((area.w - GAP * (cols - 1)) / cols));
  const h = Math.max(SMALLEST.h, Math.floor((area.h - GAP * (rows - 1)) / rows));
  return Array.from({ length: count }, (_, i) => ({
    x: Math.round(area.x + (i % cols) * (w + GAP)),
    y: Math.round(area.y + Math.floor(i / cols) * (h + GAP)),
    w,
    h,
  }));
}

/** An area too small to mean anything: a click, or a slip of the hand. */
export const tooSmall = (area: Box) => area.w < 12 || area.h < 12;

/** What Eris reads of windows: one line each, title, plugin and place. */
export function windowLines(
  windows: ReadonlyArray<{ id: string; title: string; plugin: string; box: Box }>,
): string {
  return windows
    .map(
      (w) =>
        `- ${w.title} (window ${w.id}, ${w.plugin}) at ${Math.round(w.box.x)},${Math.round(w.box.y)}, ${Math.round(w.box.w)}×${Math.round(w.box.h)}`,
    )
    .join("\n");
}
