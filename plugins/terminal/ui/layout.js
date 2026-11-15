// A terminal tab's split layout (issue 315), without a DOM: a tree whose leaves are panes (a session id
// each) and whose nodes split their box in two, right (a beside b) or down (a above b), at a ratio.
// A node's path is the a/b steps from the root ("" the root, "ba" its b's a). Boxes are fractions of
// the tab, so the view sizes them in percent and the model stays free of pixels.

/**
 * @typedef {"right" | "down"} Split
 * @typedef {"left" | "right" | "up" | "down"} Direction
 * @typedef {{ pane: string } | { split: Split, ratio: number, a: Layout, b: Layout }} Layout
 * @typedef {{ x: number, y: number, width: number, height: number }} Box
 * @typedef {{ path: string, split: Split, at: number, box: Box }} Divider
 * @typedef {{ width: number, height: number }} Min The smallest pane, as fractions of the tab.
 */

export const SPLITS = /** @type {const} */ (["right", "down"]);
export const DIRECTIONS = /** @type {const} */ (["left", "right", "up", "down"]);

/** A layout of one pane. */
export const leaf = (/** @type {string} */ id) => /** @type {Layout} */ ({ pane: id });

/** The panes in order: a before b, depth first. */
export function panesOf(/** @type {Layout} */ layout) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {Layout} */ node) => {
    if ("pane" in node) out.push(node.pane);
    else {
      walk(node.a);
      walk(node.b);
    }
  };
  walk(layout);
  return out;
}

/** `id` split in two, its half `direction` of it being the new pane `added`. */
export function split(
  /** @type {Layout} */ layout,
  /** @type {string} */ id,
  /** @type {Split} */ direction,
  /** @type {string} */ added,
) {
  if ("pane" in layout) {
    return layout.pane === id
      ? /** @type {Layout} */ ({ split: direction, ratio: 0.5, a: layout, b: leaf(added) })
      : layout;
  }
  return {
    ...layout,
    a: split(layout.a, id, direction, added),
    b: split(layout.b, id, direction, added),
  };
}

/** The layout without `id`, its sibling taking the room; null when `id` was the only pane. */
export function remove(/** @type {Layout} */ layout, /** @type {string} */ id) {
  if ("pane" in layout) return layout.pane === id ? null : layout;
  const a = remove(layout.a, id);
  const b = remove(layout.b, id);
  if (a === null) return b;
  if (b === null) return a;
  return /** @type {Layout} */ ({ ...layout, a, b });
}

/** The two halves of `box` a split at `ratio` makes. */
const halves = (
  /** @type {Box} */ box,
  /** @type {Split} */ direction,
  /** @type {number} */ ratio,
) =>
  direction === "right"
    ? [
        { ...box, width: box.width * ratio },
        { ...box, x: box.x + box.width * ratio, width: box.width * (1 - ratio) },
      ]
    : [
        { ...box, height: box.height * ratio },
        { ...box, y: box.y + box.height * ratio, height: box.height * (1 - ratio) },
      ];

const WHOLE = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

/** Every pane's box, as fractions of the tab. @returns {Record<string, Box>} */
export function boxes(/** @type {Layout} */ layout, /** @type {Box} */ box = WHOLE) {
  if ("pane" in layout) return { [layout.pane]: { ...box } };
  const [a, b] = halves(box, layout.split, layout.ratio);
  return { ...boxes(layout.a, a), ...boxes(layout.b, b) };
}

/** Every split's divider: where its line is (a fraction of the split's box) and that box. */
export function dividers(/** @type {Layout} */ layout) {
  /** @type {Divider[]} */
  const out = [];
  const walk = (/** @type {Layout} */ node, /** @type {Box} */ box, /** @type {string} */ path) => {
    if ("pane" in node) return;
    out.push({ path, split: node.split, at: node.ratio, box: { ...box } });
    const [a, b] = halves(box, node.split, node.ratio);
    walk(node.a, a, `${path}a`);
    walk(node.b, b, `${path}b`);
  };
  walk(layout, { ...WHOLE }, "");
  return out;
}

/** The node at `path`, and its box; undefined when the path leads nowhere. */
function at(/** @type {Layout} */ layout, /** @type {string} */ path) {
  let node = layout;
  /** @type {Box} */
  let box = { ...WHOLE };
  for (const step of path) {
    if ("pane" in node || (step !== "a" && step !== "b")) return undefined;
    const [a, b] = halves(box, node.split, node.ratio);
    box = step === "a" ? a : b;
    node = step === "a" ? node.a : node.b;
  }
  return { node, box };
}

/** The least width (or height) a subtree needs, as a fraction of the tab. */
function least(
  /** @type {Layout} */ node,
  /** @type {"width" | "height"} */ side,
  /** @type {Min} */ min,
) {
  if ("pane" in node) return min[side];
  const along = (node.split === "right") === (side === "width");
  const a = least(node.a, side, min);
  const b = least(node.b, side, min);
  return along ? a + b : Math.max(a, b);
}

/** The split at `path` set to `ratio`, kept where neither side is smaller than `min` allows. */
export function setRatio(
  /** @type {Layout} */ layout,
  /** @type {string} */ path,
  /** @type {number} */ ratio,
  /** @type {Min} */ min,
) {
  const found = at(layout, path);
  if (!found || "pane" in found.node || !Number.isFinite(ratio)) return layout;
  const { node, box } = found;
  const side = node.split === "right" ? "width" : "height";
  const size = box[side];
  const low = size > 0 ? least(node.a, side, min) / size : 0;
  const high = size > 0 ? 1 - least(node.b, side, min) / size : 1;
  if (low > high) return layout;
  const next = Math.round(Math.min(high, Math.max(low, ratio)) * 1e6) / 1e6;
  /** @returns {Layout} */
  const set = (/** @type {Layout} */ n, /** @type {string} */ rest) => {
    if ("pane" in n) return n;
    if (rest === "") return { ...n, ratio: next };
    return rest[0] === "a"
      ? { ...n, a: set(n.a, rest.slice(1)) }
      : { ...n, b: set(n.b, rest.slice(1)) };
  };
  return set(layout, path);
}

const EPSILON = 1e-9;
/** How much of two spans [a, a + al) and [b, b + bl) overlap. */
const overlap = (
  /** @type {number} */ a,
  /** @type {number} */ al,
  /** @type {number} */ b,
  /** @type {number} */ bl,
) => Math.min(a + al, b + bl) - Math.max(a, b);

/** The pane beside `id` on `direction`'s side, the one sharing most of that edge; `id` at an edge. */
export function neighbour(
  /** @type {Layout} */ layout,
  /** @type {string} */ id,
  /** @type {Direction} */ direction,
) {
  const all = boxes(layout);
  const from = all[id];
  if (!from) return id;
  let best = id;
  let most = EPSILON;
  for (const [other, box] of Object.entries(all)) {
    if (other === id) continue;
    const touches =
      direction === "right"
        ? Math.abs(box.x - (from.x + from.width)) < EPSILON
        : direction === "left"
          ? Math.abs(box.x + box.width - from.x) < EPSILON
          : direction === "down"
            ? Math.abs(box.y - (from.y + from.height)) < EPSILON
            : Math.abs(box.y + box.height - from.y) < EPSILON;
    if (!touches) continue;
    const shared =
      direction === "left" || direction === "right"
        ? overlap(from.y, from.height, box.y, box.height)
        : overlap(from.x, from.width, box.x, box.width);
    if (shared > most) {
      most = shared;
      best = other;
    }
  }
  return best;
}

/** The same tree with each pane's id put through `rename` (a kept layout made live, and back). */
export function mapPanes(
  /** @type {Layout} */ layout,
  /** @type {(id: string) => string} */ rename,
) {
  if ("pane" in layout) return leaf(rename(layout.pane));
  return /** @type {Layout} */ ({
    ...layout,
    a: mapPanes(layout.a, rename),
    b: mapPanes(layout.b, rename),
  });
}
