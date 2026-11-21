// Simplifying a run of positions to what a pixel shows (PG-46): positions closer than the tolerance
// to the last one kept go first (cheap), then Douglas-Peucker drops those within it of the line
// between the ones kept. The ends always stay, so a ring stays closed. The map's worker runs it,
// once per shape and zoom level (geo/layer.js). Pure.

/**
 * @param {Float64Array} xy x,y pairs
 * @param {number} tolerance in the run's units
 * @returns {Float64Array}
 */
export function simplify(xy, tolerance) {
  const n = xy.length / 2;
  if (n <= 2 || tolerance <= 0) return xy;
  const t2 = tolerance * tolerance;
  // Radial distance: keep a position once it is the tolerance away from the last one kept.
  const near = [0];
  let lx = /** @type {number} */ (xy[0]);
  let ly = /** @type {number} */ (xy[1]);
  for (let i = 1; i < n - 1; i++) {
    const x = /** @type {number} */ (xy[i * 2]);
    const y = /** @type {number} */ (xy[i * 2 + 1]);
    if ((x - lx) ** 2 + (y - ly) ** 2 > t2) {
      near.push(i);
      lx = x;
      ly = y;
    }
  }
  near.push(n - 1);
  if (near.length <= 2) return pick(xy, near);
  // Douglas-Peucker over what is left, without recursion.
  const keep = new Uint8Array(near.length);
  keep[0] = 1;
  keep[near.length - 1] = 1;
  const stack = [0, near.length - 1];
  while (stack.length) {
    const last = /** @type {number} */ (stack.pop());
    const first = /** @type {number} */ (stack.pop());
    let worst = 0;
    let at = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance2(xy, near[i] ?? 0, near[first] ?? 0, near[last] ?? 0);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > t2) {
      keep[at] = 1;
      stack.push(first, at, at, last);
    }
  }
  return pick(
    xy,
    near.filter((_, i) => keep[i]),
  );
}

/** The positions at `indexes`, as a run. */
function pick(/** @type {Float64Array} */ xy, /** @type {number[]} */ indexes) {
  const out = new Float64Array(indexes.length * 2);
  indexes.forEach((p, i) => {
    out[i * 2] = /** @type {number} */ (xy[p * 2]);
    out[i * 2 + 1] = /** @type {number} */ (xy[p * 2 + 1]);
  });
  return out;
}

/** The squared distance of position `p` from the segment from `a` to `b`. */
function segmentDistance2(
  /** @type {Float64Array} */ xy,
  /** @type {number} */ p,
  /** @type {number} */ a,
  /** @type {number} */ b,
) {
  let x = /** @type {number} */ (xy[a * 2]);
  let y = /** @type {number} */ (xy[a * 2 + 1]);
  const dx = /** @type {number} */ (xy[b * 2]) - x;
  const dy = /** @type {number} */ (xy[b * 2 + 1]) - y;
  const px = /** @type {number} */ (xy[p * 2]);
  const py = /** @type {number} */ (xy[p * 2 + 1]);
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x += dx;
      y += dy;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  return (px - x) ** 2 + (py - y) ** 2;
}
