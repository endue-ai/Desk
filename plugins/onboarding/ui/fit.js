// The first run fits its window, from the app's smallest (1024x500) up (issue 161, finding 7): Eris's orb
// gives way, never her words or a control. The orb is scaled about its centre and the room it leaves
// is taken back with negative margins, so the stage (orb, caption, form) lies between the top and
// whatever stands along the bottom edge, and a layout centre (director.centre) is still where the orb
// shows. It fits again when a form, a choice or the desk's frame comes or goes (on the timeline,
// eased) and when the window changes size (at once).

/** The sphere's height (eris/soul-text.css). */
export const ORB = 388;
/** Space kept above the stage: the orb is narrow, so Skip intro and the frame's corners keep clear. */
export const TOP = 16;
/** Space kept below the stage with nothing along the bottom edge and no frame. */
export const BOTTOM = 24;
/** Where the frame's dock ends (desk.css: #edge stands above it). */
export const ABOVE_DOCK = 88;
/** Between the stage and the choices on the edge. */
export const GAP = 12;
/** The smallest orb, as a share of its size. */
export const MIN_SCALE = 0.25;
const EASE_MS = 400;

/**
 * The orb's scale and the space below the stage for a window `height` px high: `rest` is the
 * caption's and the form's height with their margins, `edge` the height of the choices along the
 * bottom edge (0: none) standing `edgeBottom` px above it, `frame` whether the desk's frame is up.
 */
export function fitFor({ height, rest, edge = 0, edgeBottom = ABOVE_DOCK, frame = false }) {
  const bottom = edge > 0 ? edgeBottom + edge + GAP : frame ? ABOVE_DOCK : BOTTOM;
  const room = height - TOP - bottom - rest;
  const scale = Math.min(1, Math.max(MIN_SCALE, room / ORB));
  return { scale: Math.round(scale * 1000) / 1000, bottom };
}

const $ = (id) => document.getElementById(id);
const px = (value) => Number.parseFloat(value) || 0;

/** What the page holds now, measured from layout (transforms do not count). */
function measure() {
  const cap = $("cap");
  const slot = $("formslot");
  const edge = $("edge");
  const rest =
    cap.offsetHeight +
    px(getComputedStyle(cap).marginTop) +
    slot.offsetHeight +
    px(getComputedStyle(slot).marginTop);
  const fit = fitFor({
    height: window.innerHeight,
    rest,
    edge: edge.childElementCount > 0 ? edge.offsetHeight : 0,
    edgeBottom: px(getComputedStyle(edge).bottom),
    frame: $("frame").childElementCount > 0,
  });
  return { ...fit, rest };
}

/** The styles a fit sets: the orb's scale and margins, the root's padding. */
function styles({ scale, bottom }) {
  const margin = `${Math.round((ORB * (scale - 1)) / 2)}px`;
  return {
    orb: { scale: String(scale), marginTop: margin, marginBottom: margin },
    root: { paddingTop: `${TOP}px`, paddingBottom: `${bottom}px` },
  };
}

/** The orb's scale in force: what the last fit set, 1 before the first. */
export function orbScale() {
  return Number.parseFloat($("sphere").style.scale) || 1;
}

/** Where the stage's top stands once the page as it is now is fitted (it is centred in its room). */
export function fittedTop() {
  const { scale, bottom, rest } = measure();
  const room = window.innerHeight - TOP - bottom;
  return TOP + Math.max(0, (room - ORB * scale - rest) / 2);
}

/**
 * Keep the director's stage fitted: at once now and on every resize, eased on its timeline when
 * the form, the edge or the frame changes. Returns a function that fits again at once.
 */
export function watchFit(d) {
  const sphere = $("sphere");
  const root = $("root");
  let easing = [];
  let shown = "";
  const apply = (animate) => {
    const target = styles(measure());
    const key = JSON.stringify(target);
    if (key === shown) return;
    shown = key;
    const from = {
      orb: pick(getComputedStyle(sphere), target.orb),
      root: pick(getComputedStyle(root), target.root),
    };
    for (const animation of easing) animation.cancel();
    easing = [];
    Object.assign(sphere.style, target.orb);
    Object.assign(root.style, target.root);
    if (!animate) return;
    const at = d.timeline.time;
    easing = [
      d.move(sphere, [from.orb, target.orb], at, EASE_MS),
      d.move(root, [from.root, target.root], at, EASE_MS),
    ];
  };
  const observer = new MutationObserver(() => apply(true));
  const watch = { childList: true, subtree: true, characterData: true };
  for (const id of ["formslot", "edge"]) observer.observe($(id), watch);
  observer.observe($("frame"), { childList: true });
  window.addEventListener("resize", () => apply(false));
  apply(false);
  return () => apply(false);
}

const pick = (computed, keys) =>
  Object.fromEntries(Object.keys(keys).map((key) => [key, computed[key]]));
