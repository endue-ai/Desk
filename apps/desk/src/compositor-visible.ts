// Compositor mode (#52): which parts of a plugin frame nothing in the shell page covers. The
// compositor draws the plugin's surface there, over the page, so whatever the page draws above the
// frame (a window above, a bar, a menu, the Eris pill) must be left out of it.

/** A rectangle in the page's CSS pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SMALLEST = 0.5;

function area(b: Box): boolean {
  return b.width >= SMALLEST && b.height >= SMALLEST;
}

export function intersect(a: Box, b: Box): Box | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  const box = { x, y, width, height };
  return area(box) ? box : undefined;
}

/** `a` without `b`: up to four boxes (above, below, left, right of the overlap). */
export function subtract(a: Box, b: Box): Box[] {
  const overlap = intersect(a, b);
  if (!overlap) return [a];
  const bottom = a.y + a.height;
  const parts: Box[] = [
    { x: a.x, y: a.y, width: a.width, height: overlap.y - a.y },
    {
      x: a.x,
      y: overlap.y + overlap.height,
      width: a.width,
      height: bottom - overlap.y - overlap.height,
    },
    { x: a.x, y: overlap.y, width: overlap.x - a.x, height: overlap.height },
    {
      x: overlap.x + overlap.width,
      y: overlap.y,
      width: a.x + a.width - overlap.x - overlap.width,
      height: overlap.height,
    },
  ];
  return parts.filter(area);
}

/** What the page hit-tests and measures, so the walk is tested without a layout engine. */
export interface Geometry {
  /** Everything at a point, topmost first (`elementsFromPoint`). */
  stack(x: number, y: number): Element[];
  /** Where an element shows. */
  box(element: Element): Box;
  /** Whether an element draws anything of its own (an empty transparent grip does not). */
  paints(element: Element): boolean;
}

/** What covers `frame` at a point whose `stack` this is: the topmost element above it that paints. */
export function coverAt(stack: Element[], frame: Element, geometry: Geometry): Element | undefined {
  let cover: Element | undefined;
  for (const element of stack) {
    // The frame, or an ancestor (a frame without pointer events): what painted above it covers it.
    if (element === frame || element.contains(frame)) return cover;
    if (!cover && geometry.paints(element)) cover = element;
  }
  return undefined;
}

/** What the hit test finds on a grid over the page. */
export interface Hit {
  x: number;
  y: number;
  stack: Element[];
}

/** Hit-test the whole page once, `step` pixels apart: a strip across a frame (a bar) is never missed. */
export function screenHits(width: number, height: number, step: number, geometry: Geometry): Hit[] {
  const hits: Hit[] = [];
  for (let y = step / 2; y < height; y += step)
    for (let x = step / 2; x < width; x += step) hits.push({ x, y, stack: geometry.stack(x, y) });
  return hits;
}

/**
 * How far from a corner of a frame nothing is looked at: its window rounds the frame off there, so
 * what shows at a corner is what is under the window, which covers nothing of the frame.
 */
const CORNER = 16;

function nearCorner(x: number, y: number, b: Box): boolean {
  const dx = Math.min(x - b.x, b.x + b.width - x);
  const dy = Math.min(y - b.y, b.y + b.height - y);
  return dx < CORNER && dy < CORNER;
}

/** Where to look again for what covers a box: its edges' middles, its middle, its corners inset. */
function samples(b: Box): Array<[number, number]> {
  const inset = (low: number, size: number) => [
    low + Math.min(CORNER, size / 2),
    low + size / 2,
    low + size - Math.min(CORNER, size / 2),
  ];
  const edges: Array<[number, number]> = [
    [b.x + b.width / 2, b.y + 1],
    [b.x + b.width / 2, b.y + b.height - 1],
    [b.x + 1, b.y + b.height / 2],
    [b.x + b.width - 1, b.y + b.height / 2],
  ];
  const ys = inset(b.y, b.height);
  return [...edges, ...inset(b.x, b.width).flatMap((x) => ys.map((y): [number, number] => [x, y]))];
}

/**
 * The parts of `clip` where `frame` shows. What the page's grid (`hits`) found over it has its own
 * visible box cut out; then the rest is looked at again at its corners, edges and middle, a few
 * rounds at most. The element that paints, not a container of it: a container's box may reach where
 * it paints nothing, or not reach where its children overflow it.
 */
export function visiblePieces(
  frame: Element,
  clip: Box,
  geometry: Geometry,
  hits: Hit[] = [],
): Box[] {
  const seeds = new Set<Element>();
  for (const { x, y, stack } of hits) {
    const inside =
      x >= clip.x && y >= clip.y && x < clip.x + clip.width && y < clip.y + clip.height;
    const cover = inside && !nearCorner(x, y, clip) ? coverAt(stack, frame, geometry) : undefined;
    if (cover) seeds.add(cover);
  }
  const cut = (pieces: Box[], covers: Box[]) =>
    covers.reduce((left, cover) => left.flatMap((piece) => subtract(piece, cover)), pieces);
  let pieces = cut(
    [clip].filter(area),
    [...seeds].map((e) => geometry.box(e)),
  );
  for (let round = 0; round < 8 && pieces.length > 0 && pieces.length < 64; round++) {
    const covers: Box[] = [];
    for (const piece of pieces)
      for (const [x, y] of samples(piece)) {
        const cover = coverAt(geometry.stack(x, y), frame, geometry);
        if (cover) covers.push(geometry.box(cover));
      }
    if (covers.length === 0) break;
    pieces = cut(pieces, covers);
  }
  return pieces;
}

const REPLACED = new Set([
  "IMG",
  "CANVAS",
  "VIDEO",
  "IFRAME",
  "SVG",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
]);

/** The alpha of a computed colour (`rgb(…)` is 1, `rgba(…, a)` is a, `transparent` is 0). */
function alpha(colour: string): number {
  if (colour === "transparent" || colour === "") return 0;
  const match = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(colour);
  return match ? Number(match[1]) : 1;
}

/**
 * Whether `element` covers what is under it: a background at least half opaque, a border, its own
 * text, or replaced content. A see-through one (a window's resize grip drawn as a gradient, a faint
 * hover tint, a shadow) does not: cutting it out of a frame would show the stand-in under it, while
 * drawing the surface over it only hides its faint mark.
 */
export function paintsIn(win: Window, element: Element): boolean {
  if (REPLACED.has(element.tagName.toUpperCase())) return true;
  const style = win.getComputedStyle(element);
  if (style.visibility === "hidden" || Number(style.opacity) < 0.5) return false;
  if (alpha(style.backgroundColor) >= 0.5) return true;
  const border = ["top", "right", "bottom", "left"].some((side) => {
    const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
    return width > 0 && alpha(style.getPropertyValue(`border-${side}-color`)) >= 0.5;
  });
  if (border) return true;
  return [...element.childNodes].some(
    (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
  );
}
