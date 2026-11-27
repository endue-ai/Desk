/**
 * What Eris shows of a line while she works on it (ADR 0275): a ring round her body in the star's
 * colour, the brand's mark of an agent at work. It turns while she reads a line or an answer that
 * came back (`reading`), dims while her errands are out with the plugins (`waiting`), and is gone
 * otherwise (`eris.css`, by `data-mind` on her; a spoken turn's `data-talk="thinking"` shows it
 * too). As a line or a plugin's answer reaches her, a ring closes into her core, and as a request
 * leaves her one opens out of it (`takeIn`), on the ticker. The talk line's errands and a spoken
 * turn's set it on the same Eris.
 */
import { cubicBezier } from "../ease";
import type { ShellCtx } from "../shell/context";

export type Mind = "reading" | "waiting";

/** A line or an answer closing into her. */
export const TAKE_MS = 420;
const SVG = "http://www.w3.org/2000/svg";
/** The ring's box, centred on her core; the arcs' radius; three arcs of `ARC` with gaps between. */
const BOX = 148;
const R = 66;
const ARC = 48;
const takeEase = cubicBezier(0.3, 0, 0.2, 1);
let takes = 0;

const svg = <K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | number>,
) => {
  const el = doc.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
};

/** A point on the ring `deg` degrees clockwise from her right, as SVG draws a circle's stroke. */
const on = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180;
  return { cx: (BOX / 2 + r * Math.cos(a)).toFixed(2), cy: (BOX / 2 + r * Math.sin(a)).toFixed(2) };
};

/**
 * The ring's parts, for her body: three arcs with a mote at each one's head and an inner pair that
 * turns the other way, and the ring that closes in. Out of the accessibility tree.
 */
export function mindOf(doc: Document): SVGSVGElement {
  const c = BOX / 2;
  const root = svg(doc, "svg", {
    class: "eris-mind",
    viewBox: `0 0 ${BOX} ${BOX}`,
    "aria-hidden": "true",
  });
  const gap = (2 * Math.PI * R) / 3 - ARC;
  const head = (ARC / (2 * Math.PI * R)) * 360;
  const outer = svg(doc, "g", { class: "eris-mind-turn" });
  outer.append(
    svg(doc, "circle", {
      class: "eris-mind-arc",
      cx: c,
      cy: c,
      r: R,
      "stroke-dasharray": `${ARC} ${gap.toFixed(2)}`,
    }),
    ...[0, 120, 240].map((deg) =>
      svg(doc, "circle", { class: "eris-mind-mote", ...on(deg + head), r: 2.2 }),
    ),
  );
  const r = R - 10;
  const inner = svg(doc, "g", { class: "eris-mind-turn eris-mind-turn--back" });
  inner.append(
    svg(doc, "circle", {
      class: "eris-mind-arc eris-mind-arc--inner",
      cx: c,
      cy: c,
      r,
      "stroke-dasharray": `18 ${(Math.PI * r - 18).toFixed(2)}`,
    }),
  );
  root.append(outer, inner, svg(doc, "circle", { class: "eris-intake", cx: c, cy: c, r: R }));
  return root;
}

/** Say on the Eris in `host` what she is at with a line, or that she is at none. */
export function setMind(host: ParentNode, mind: Mind | null): void {
  const eris = host.querySelector<HTMLElement>(".eris");
  if (!eris || eris.dataset.mind === (mind ?? undefined)) return;
  if (mind) eris.dataset.mind = mind;
  else delete eris.dataset.mind;
}

/**
 * Something reaches her (a line, a plugin's answer): a ring closes into her core and is gone; or
 * something leaves her (`out`, an errand's request): it opens out from her core. A later one takes
 * its place; with reduced motion, or no ring, nothing moves.
 */
export function takeIn(
  host: ParentNode,
  ctx: Pick<ShellCtx, "ticker" | "reduced">,
  way: "in" | "out" = "in",
): Promise<void> {
  const ring = host.querySelector<SVGCircleElement>(".eris-intake");
  if (!ring || ctx.reduced()) return Promise.resolve();
  const take = String(++takes);
  ring.dataset.take = take;
  ring.dataset.way = way;
  return ctx.ticker.animate(TAKE_MS, takeEase, (t) => {
    if (ring.dataset.take !== take) return;
    const scale = way === "in" ? 1.3 - 0.95 * t : 0.35 + 0.95 * t;
    ring.style.transform = `scale(${scale.toFixed(3)})`;
    ring.style.opacity = (Math.sin(Math.PI * t) * 0.9).toFixed(3);
  });
}
