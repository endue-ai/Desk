/**
 * The thread an errand's spark runs along (ADR 0271): the way between Eris and a window, drawn in
 * the star's colour with marks that run the way the data goes, out with what she asks and back
 * with the answer (`errand.css`). The spark flies the same shallow arc (`arc`), so it reads as
 * thrown rather than slid. The thread's box holds the whole way. It ends on the window's border and
 * is laid again (`shapeThread`) whenever Eris, the window or the desk's pan moves, so they stay joined.
 */

export interface Point {
  x: number;
  y: number;
}

const SVG = "http://www.w3.org/2000/svg";
/** The straight pieces the arc is drawn in. */
const PIECES = 24;
/** Room around the way for the line's width and its glow. */
const ROOM = 8;

/** Where a spark thrown from `from` to `to` is, `t` of the way there (0 to 1). */
export function arc(from: Point, to: Point, t: number): Point {
  const lift = Math.sin(Math.PI * t) * Math.min(60, Math.abs(to.x - from.x) / 4);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - lift };
}

/** The thread from `from` to `to`, in their host's coordinates; its marks run from `from`. */
export function threadOf(doc: Document, from: Point, to: Point): SVGSVGElement {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "errand-thread");
  svg.setAttribute("aria-hidden", "true");
  for (const part of ["errand-thread-line", "errand-thread-flow"]) {
    const path = doc.createElementNS(SVG, "path");
    path.setAttribute("class", part);
    svg.append(path);
  }
  return shapeThread(svg, from, to);
}

/**
 * Lay `svg` from `from` to `to` again, in place: a thread's ends move with Eris and with the window
 * it leads to, frame by frame, and a frame where neither moved changes nothing.
 */
export function shapeThread(svg: SVGSVGElement, from: Point, to: Point): SVGSVGElement {
  const key = [from.x, from.y, to.x, to.y].map((n) => n.toFixed(1)).join(" ");
  if (svg.dataset.way === key) return svg;
  svg.dataset.way = key;
  const way = Array.from({ length: PIECES + 1 }, (_, i) => arc(from, to, i / PIECES));
  const left = Math.min(...way.map((p) => p.x)) - ROOM;
  const top = Math.min(...way.map((p) => p.y)) - ROOM;
  const width = Math.max(...way.map((p) => p.x)) + ROOM - left;
  const height = Math.max(...way.map((p) => p.y)) + ROOM - top;
  svg.setAttribute("width", width.toFixed(1));
  svg.setAttribute("height", height.toFixed(1));
  svg.style.left = `${left.toFixed(1)}px`;
  svg.style.top = `${top.toFixed(1)}px`;
  const d = way
    .map((p, i) => `${i ? "L" : "M"}${(p.x - left).toFixed(1)} ${(p.y - top).toFixed(1)}`)
    .join("");
  for (const path of svg.querySelectorAll("path")) path.setAttribute("d", d);
  return svg;
}
