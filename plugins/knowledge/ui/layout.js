// A force-directed layout, run in a worker: nodes repel each other (Barnes–Hut, so thousands stay
// fast), edges pull their ends together, a weak pull keeps the whole near the middle. Velocity
// Verlet with a cooling step, as d3-force does. Deterministic: the same graph lays out the same.

/**
 * @typedef {{ n: number, edges: Int32Array, weights?: Float32Array, mass?: Float32Array,
 *   start?: Float32Array, iterations?: number }} LayoutInput
 */

const THETA2 = 0.81;
const CHARGE = -30;
const DISTANCE = 30;
const GRAVITY = 0.02;
const DECAY = 0.4;
/** A softened distance floor: two nodes on one spot still push apart. */
const SOFT = 1;

/**
 * Positions for `n` nodes as [x0, y0, x1, y1, …]. `edges` holds index pairs; `weights` their pull
 * (1 by default); `mass` each node's charge (1 by default; hubs heavier spread their neighbours);
 * `start` known positions (NaN for unknown), which then cool from a later step.
 * @param {LayoutInput} input
 * @returns {Float32Array}
 */
export function layout(input) {
  const { n, edges } = input;
  const pos = new Float64Array(2 * n);
  const vel = new Float64Array(2 * n);
  const mass = input.mass ?? new Float32Array(n).fill(1);
  const known = seed(n, pos, input.start);
  const iterations = input.iterations ?? (known > n / 2 ? 120 : 300);
  const degree = new Float64Array(n);
  for (let e = 0; e < edges.length; e += 2) {
    degree[edges[e]] += 1;
    degree[edges[e + 1]] += 1;
  }
  let alpha = known > n / 2 ? 0.3 : 1;
  const decay = 1 - 0.001 ** (1 / iterations);
  for (let step = 0; step < iterations && n > 0; step++) {
    repel(n, pos, vel, mass, alpha);
    attract(edges, input.weights, degree, pos, vel, alpha);
    for (let i = 0; i < n; i++) {
      vel[2 * i] = (vel[2 * i] - pos[2 * i] * GRAVITY * alpha) * (1 - DECAY);
      vel[2 * i + 1] = (vel[2 * i + 1] - pos[2 * i + 1] * GRAVITY * alpha) * (1 - DECAY);
      pos[2 * i] += vel[2 * i];
      pos[2 * i + 1] += vel[2 * i + 1];
    }
    alpha += (0 - alpha) * decay;
  }
  return Float32Array.from(pos);
}

/** Known positions where given, the rest on a sunflower spiral. Returns how many were known. */
function seed(
  /** @type {number} */ n,
  /** @type {Float64Array} */ pos,
  /** @type {Float32Array | undefined} */ start,
) {
  let known = 0;
  const angle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const x = start?.[2 * i];
    const y = start?.[2 * i + 1];
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
      pos[2 * i] = x;
      pos[2 * i + 1] = y;
      known += 1;
    } else {
      const r = 10 * Math.sqrt(0.5 + i);
      pos[2 * i] = r * Math.cos(i * angle);
      pos[2 * i + 1] = r * Math.sin(i * angle);
    }
  }
  return known;
}

/** Each edge pulls its ends toward DISTANCE apart, the lighter end moving more. */
function attract(
  /** @type {Int32Array} */ edges,
  /** @type {Float32Array | undefined} */ weights,
  /** @type {Float64Array} */ degree,
  /** @type {Float64Array} */ pos,
  /** @type {Float64Array} */ vel,
  /** @type {number} */ alpha,
) {
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e];
    const b = edges[e + 1];
    let dx = pos[2 * b] + vel[2 * b] - pos[2 * a] - vel[2 * a] || 1e-6;
    let dy = pos[2 * b + 1] + vel[2 * b + 1] - pos[2 * a + 1] - vel[2 * a + 1] || 1e-6;
    const d = Math.sqrt(dx * dx + dy * dy);
    const strength = (weights?.[e / 2] ?? 1) / Math.min(degree[a], degree[b]);
    const pull = ((d - DISTANCE) / d) * alpha * strength;
    dx *= pull;
    dy *= pull;
    const bias = degree[a] / (degree[a] + degree[b]);
    vel[2 * b] -= dx * bias;
    vel[2 * b + 1] -= dy * bias;
    vel[2 * a] += dx * (1 - bias);
    vel[2 * a + 1] += dy * (1 - bias);
  }
}

/** Many-body repulsion over a quadtree: a far cell acts as one body at its centre of charge. */
function repel(
  /** @type {number} */ n,
  /** @type {Float64Array} */ pos,
  /** @type {Float64Array} */ vel,
  /** @type {Float32Array} */ mass,
  /** @type {number} */ alpha,
) {
  const tree = quadtree(n, pos, mass);
  const stack = new Int32Array(64 * 4 + n * 4);
  for (let i = 0; i < n; i++) {
    const x = pos[2 * i];
    const y = pos[2 * i + 1];
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const cell = stack[--top];
      const charge = tree.charge[cell];
      if (charge === 0) continue;
      const dx = tree.cx[cell] - x;
      const dy = tree.cy[cell] - y;
      const l = dx * dx + dy * dy + SOFT;
      const size = tree.size[cell];
      const leaf =
        tree.child[4 * cell] < 0 &&
        tree.child[4 * cell + 1] < 0 &&
        tree.child[4 * cell + 2] < 0 &&
        tree.child[4 * cell + 3] < 0;
      if (leaf || (size * size) / THETA2 < l) {
        if (leaf && tree.body[cell] === i && tree.count[cell] === 1) continue;
        const own = leaf && tree.body[cell] === i ? mass[i] : 0;
        const w = (CHARGE * (charge - own) * alpha) / l;
        vel[2 * i] += dx * w;
        vel[2 * i + 1] += dy * w;
        continue;
      }
      for (let q = 0; q < 4; q++)
        if (tree.child[4 * cell + q] >= 0) stack[top++] = tree.child[4 * cell + q];
    }
  }
}

/**
 * A quadtree over the positions: per cell its size, centre of charge and total charge, its four
 * children (-1 for none) and, for a leaf, its body (several at one spot share a leaf).
 */
function quadtree(
  /** @type {number} */ n,
  /** @type {Float64Array} */ pos,
  /** @type {Float32Array} */ mass,
) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, pos[2 * i]);
    y0 = Math.min(y0, pos[2 * i + 1]);
    x1 = Math.max(x1, pos[2 * i]);
    y1 = Math.max(y1, pos[2 * i + 1]);
  }
  const span = Math.max(x1 - x0, y1 - y0, 1);
  const cap = 4 * n + 8;
  const t = {
    size: new Float64Array(cap),
    ox: new Float64Array(cap),
    oy: new Float64Array(cap),
    cx: new Float64Array(cap),
    cy: new Float64Array(cap),
    charge: new Float64Array(cap),
    count: new Int32Array(cap),
    body: new Int32Array(cap).fill(-1),
    child: new Int32Array(4 * cap).fill(-1),
    cells: 1,
  };
  t.size[0] = span;
  t.ox[0] = x0;
  t.oy[0] = y0;
  for (let i = 0; i < n; i++) insert(t, i, pos, mass, cap);
  return t;
}

function insert(
  /** @type {any} */ t,
  /** @type {number} */ i,
  /** @type {Float64Array} */ pos,
  /** @type {Float32Array} */ mass,
  /** @type {number} */ cap,
) {
  const x = pos[2 * i];
  const y = pos[2 * i + 1];
  const m = mass[i];
  let cell = 0;
  for (let depth = 0; ; depth++) {
    const total = t.charge[cell] + m;
    t.cx[cell] = (t.cx[cell] * t.charge[cell] + x * m) / total;
    t.cy[cell] = (t.cy[cell] * t.charge[cell] + y * m) / total;
    t.charge[cell] = total;
    t.count[cell] += 1;
    const isLeaf =
      t.child[4 * cell] < 0 &&
      t.child[4 * cell + 1] < 0 &&
      t.child[4 * cell + 2] < 0 &&
      t.child[4 * cell + 3] < 0;
    if (isLeaf && t.body[cell] < 0) {
      t.body[cell] = i;
      return;
    }
    // A leaf with a body: one spot, or too deep, or out of room keeps both in the leaf.
    if (isLeaf) {
      const other = t.body[cell];
      const same = pos[2 * other] === x && pos[2 * other + 1] === y;
      if (same || depth > 40 || t.cells + 4 > cap) return;
      t.body[cell] = -1;
      push(t, cell, other, pos, mass, t.count[cell] - 1, t.charge[cell] - m);
    }
    cell = childFor(t, cell, x, y, cap);
    if (cell < 0) return;
  }
}

/** Move a leaf's body down into the child it falls in. */
function push(
  /** @type {any} */ t,
  /** @type {number} */ cell,
  /** @type {number} */ body,
  /** @type {Float64Array} */ pos,
  /** @type {Float32Array} */ mass,
  /** @type {number} */ count,
  /** @type {number} */ charge,
) {
  const into = childFor(t, cell, pos[2 * body], pos[2 * body + 1], Infinity);
  t.body[into] = body;
  t.count[into] = count;
  t.charge[into] = charge;
  t.cx[into] = pos[2 * body];
  t.cy[into] = pos[2 * body + 1];
  void mass;
}

/** The child of `cell` holding (x, y), made when missing; -1 when the tree is full. */
function childFor(
  /** @type {any} */ t,
  /** @type {number} */ cell,
  /** @type {number} */ x,
  /** @type {number} */ y,
  /** @type {number} */ cap,
) {
  const half = t.size[cell] / 2;
  const right = x >= t.ox[cell] + half ? 1 : 0;
  const down = y >= t.oy[cell] + half ? 1 : 0;
  const q = right + 2 * down;
  let child = t.child[4 * cell + q];
  if (child < 0) {
    if (t.cells >= cap) return -1;
    child = t.cells++;
    t.child[4 * cell + q] = child;
    t.size[child] = half;
    t.ox[child] = t.ox[cell] + right * half;
    t.oy[child] = t.oy[cell] + down * half;
  }
  return child;
}
