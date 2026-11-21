// The ER diagram's lines (PG-55): each foreign key an orthogonal line from the side of the table
// that refers to the side of the table referred to, at the rows of their columns when those show.
// A few routes are tried (between facing sides at several places, around either side, between top
// and bottom) and the one that crosses the fewest other tables, then the shortest, is kept; a grid
// of cells finds the tables near a segment. Every route leaves and enters a box straight for at
// least STUB, where its ends' marks are drawn. Pure.

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ from: number, to: number, fromY: number, toY: number }} Wire
 *   Box indexes and the heights of the ends inside their boxes (from the box's top).
 * @typedef {[number, number][]} Points
 */

export const STUB = 24;
const CELL = 256;
const CROSS = 100_000;

/** Boxes in cells of a grid, to find those near a segment without looking at all of them. */
export function indexOf(/** @type {Rect[]} */ boxes) {
  /** @type {Map<string, number[]>} */
  const cells = new Map();
  boxes.forEach((b, i) => {
    for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++)
      for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++) {
        const key = `${cx},${cy}`;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
  });
  /** The boxes but `skip`'s an axis-aligned segment crosses. */
  const hits = (
    /** @type {number} */ x1,
    /** @type {number} */ y1,
    /** @type {number} */ x2,
    /** @type {number} */ y2,
    /** @type {number[]} */ skip,
  ) => {
    const [lx, hx] = x1 < x2 ? [x1, x2] : [x2, x1];
    const [ly, hy] = y1 < y2 ? [y1, y2] : [y2, y1];
    /** @type {Set<number>} */
    const seen = new Set();
    /** @type {number[]} */
    const out = [];
    for (let cx = Math.floor(lx / CELL); cx <= Math.floor(hx / CELL); cx++)
      for (let cy = Math.floor(ly / CELL); cy <= Math.floor(hy / CELL); cy++)
        for (const i of cells.get(`${cx},${cy}`) ?? []) {
          if (seen.has(i) || skip.includes(i)) continue;
          seen.add(i);
          const b = /** @type {Rect} */ (boxes[i]);
          if (hx > b.x + 1 && lx < b.x + b.w - 1 && hy > b.y + 1 && ly < b.y + b.h - 1) out.push(i);
        }
    return out;
  };
  return {
    boxes,
    hits,
    /** How many boxes but `skip`'s an axis-aligned segment crosses. */
    crossings: (
      /** @type {number} */ x1,
      /** @type {number} */ y1,
      /** @type {number} */ x2,
      /** @type {number} */ y2,
      /** @type {number[]} */ skip,
    ) => hits(x1, y1, x2, y2, skip).length,
  };
}

/** Places between `lo` and `hi` a vertical (or horizontal) run may take, nudged per line. */
const between = (
  /** @type {number} */ lo,
  /** @type {number} */ hi,
  /** @type {number} */ nudge,
) => {
  const out = new Set([
    Math.round((lo + hi) / 2 + nudge),
    lo + STUB,
    hi - STUB,
    Math.round(lo + (hi - lo) / 4),
    Math.round(lo + ((hi - lo) * 3) / 4),
  ]);
  return [...out].filter((m) => m >= lo + STUB && m <= hi - STUB);
};

/** The cost of a route: tables crossed first, then length. */
function cost(
  /** @type {ReturnType<typeof indexOf>} */ index,
  /** @type {Points} */ points,
  /** @type {number[]} */ skip,
) {
  let crossed = 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = /** @type {[number, number]} */ (points[i - 1]);
    const [x2, y2] = /** @type {[number, number]} */ (points[i]);
    crossed += index.crossings(x1, y1, x2, y2, skip);
    length += Math.abs(x2 - x1) + Math.abs(y2 - y1);
  }
  return crossed * CROSS + length;
}

/**
 * The route of one line.
 * @param {ReturnType<typeof indexOf>} index
 * @param {Wire} wire
 * @param {number} n The line's number, to keep parallel runs apart.
 * @returns {Points}
 */
export function routeOne(index, wire, n = 0) {
  const a = /** @type {Rect} */ (index.boxes[wire.from]);
  const b = /** @type {Rect} */ (index.boxes[wire.to]);
  const ya = a.y + wire.fromY;
  const yb = b.y + wire.toY;
  const ar = a.x + a.w;
  const br = b.x + b.w;
  if (wire.from === wire.to) {
    const y2 = Math.min(a.y + a.h - 4, ya + 18);
    return [
      [ar, ya],
      [ar + STUB, ya],
      [ar + STUB, y2],
      [ar, y2],
    ];
  }
  const nudge = ((n % 5) - 2) * 4;
  /** @type {Points[]} */
  const routes = [];
  if (ar + 2 * STUB <= b.x)
    for (const m of between(ar, b.x, nudge))
      routes.push([
        [ar, ya],
        [m, ya],
        [m, yb],
        [b.x, yb],
      ]);
  if (br + 2 * STUB <= a.x)
    for (const m of between(br, a.x, nudge))
      routes.push([
        [a.x, ya],
        [m, ya],
        [m, yb],
        [br, yb],
      ]);
  const right = Math.max(ar, br) + STUB + Math.abs(nudge);
  const left = Math.min(a.x, b.x) - STUB - Math.abs(nudge);
  routes.push(
    [
      [ar, ya],
      [right, ya],
      [right, yb],
      [br, yb],
    ],
    [
      [a.x, ya],
      [left, ya],
      [left, yb],
      [b.x, yb],
    ],
  );
  const ax = Math.round(a.x + a.w / 2 + nudge);
  const bx = Math.round(b.x + b.w / 2 + nudge);
  if (a.y + a.h + 2 * STUB <= b.y)
    for (const m of between(a.y + a.h, b.y, 0))
      routes.push([
        [ax, a.y + a.h],
        [ax, m],
        [bx, m],
        [bx, b.y],
      ]);
  if (b.y + b.h + 2 * STUB <= a.y)
    for (const m of between(b.y + b.h, a.y, 0))
      routes.push([
        [ax, a.y],
        [ax, m],
        [bx, m],
        [bx, b.y + b.h],
      ]);
  const skip = [wire.from, wire.to];
  // Over or under the tables in the way of a straight run between facing sides.
  const facing = ar + 2 * STUB <= b.x ? [ar, b.x, 1] : br + 2 * STUB <= a.x ? [a.x, br, -1] : null;
  if (facing) {
    const [from, to, dir] = /** @type {[number, number, number]} */ (facing);
    const crossed = [
      ...index.hits(from, ya, to, ya, skip),
      ...index.hits(from, yb, to, yb, skip),
    ].map((i) => /** @type {Rect} */ (index.boxes[i]));
    if (crossed.length) {
      const out = from + dir * STUB;
      const into = to - dir * STUB;
      for (const level of [
        Math.min(...crossed.map((r) => r.y)) - STUB - Math.abs(nudge),
        Math.max(...crossed.map((r) => r.y + r.h)) + STUB + Math.abs(nudge),
      ])
        routes.push([
          [from, ya],
          [out, ya],
          [out, level],
          [into, level],
          [into, yb],
          [to, yb],
        ]);
    }
  }
  let best = /** @type {Points} */ (routes[0]);
  let low = Infinity;
  for (const route of routes) {
    const c = cost(index, route, skip);
    if (c < low) {
      low = c;
      best = route;
    }
  }
  return best;
}

/**
 * Routes for wires, all of them or those of `only` (a moved table's), on boxes as they stand.
 * @param {Rect[]} boxes
 * @param {Wire[]} wires
 * @param {Set<number>} [only] Indexes of the wires to route.
 * @returns {Map<number, Points>}
 */
export function routeAll(boxes, wires, only) {
  const index = indexOf(boxes);
  /** @type {Map<number, Points>} */
  const out = new Map();
  wires.forEach((wire, i) => {
    if (!only || only.has(i)) out.set(i, routeOne(index, wire, i));
  });
  return out;
}
