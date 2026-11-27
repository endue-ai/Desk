// Where the ER diagram's tables go (PG-55): a layered layout over the foreign keys, each referenced
// table a layer left of the tables that refer to it (cycles broken, self references ignored), the
// tables of a layer ordered by their neighbours to keep lines short, a tall layer wrapped into
// columns, and each group of connected tables packed beside the others with the lone tables last.
// `place` keeps the positions a diagram holds and puts only the new tables, beside them. Pure: the
// worker (layout-worker.js) runs it for a large diagram.

/**
 * @typedef {{ id: string, w: number, h: number }} Node
 * @typedef {{ from: string, to: string }} Edge `from` refers to `to`.
 * @typedef {Map<string, [number, number]>} Positions
 */

export const GAP_X = 96;
export const GAP_Y = 36;
const SWEEPS = 6;

/**
 * Every node's position, laid out afresh.
 * @param {Node[]} nodes
 * @param {Edge[]} edges
 * @returns {Positions}
 */
export function arrange(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const real = edges.filter((e) => e.from !== e.to && byId.has(e.from) && byId.has(e.to));
  const groups = components(nodes, real);
  /** @type {{ at: Positions, w: number, h: number }[]} */
  const blocks = [];
  const lone = [];
  for (const group of groups) {
    if (group.length === 1) lone.push(/** @type {Node} */ (group[0]));
    else blocks.push(layered(group, real));
  }
  if (lone.length) blocks.push(grid(lone));
  return pack(blocks);
}

/**
 * Keep `kept`'s positions; lay the other nodes out among themselves and put them to the right of
 * every kept box, so no new table lands on one the person placed.
 * @param {Node[]} nodes
 * @param {Edge[]} edges
 * @param {Positions} kept
 * @returns {Positions}
 */
export function place(nodes, edges, kept) {
  const old = nodes.filter((n) => kept.has(n.id));
  if (old.length === 0) return arrange(nodes, edges);
  /** @type {Positions} */
  const out = new Map(old.map((n) => [n.id, /** @type {[number, number]} */ (kept.get(n.id))]));
  const fresh = nodes.filter((n) => !kept.has(n.id));
  if (fresh.length === 0) return out;
  const ids = new Set(fresh.map((n) => n.id));
  const laid = arrange(
    fresh,
    edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  );
  const right = Math.max(...old.map((n) => (out.get(n.id)?.[0] ?? 0) + n.w));
  const top = Math.min(...old.map((n) => out.get(n.id)?.[1] ?? 0));
  for (const [id, [x, y]] of laid) out.set(id, [right + GAP_X + x, top + y]);
  return out;
}

/** The connected groups of nodes, the largest first. */
function components(/** @type {Node[]} */ nodes, /** @type {Edge[]} */ edges) {
  /** @type {Map<string, string>} */
  const up = new Map(nodes.map((n) => [n.id, n.id]));
  const root = (/** @type {string} */ id) => {
    let at = id;
    while (up.get(at) !== at) {
      const next = /** @type {string} */ (up.get(/** @type {string} */ (up.get(at))));
      up.set(at, next);
      at = next;
    }
    return at;
  };
  for (const e of edges) up.set(root(e.from), root(e.to));
  /** @type {Map<string, Node[]>} */
  const groups = new Map();
  for (const n of nodes) {
    const r = root(n.id);
    const list = groups.get(r);
    if (list) list.push(n);
    else groups.set(r, [n]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

/** One connected group in layers, left to right. */
function layered(/** @type {Node[]} */ group, /** @type {Edge[]} */ all) {
  const ids = new Set(group.map((n) => n.id));
  const edges = all.filter((e) => ids.has(e.from));
  /** @type {Map<string, string[]>} */
  const parents = new Map(group.map((n) => [n.id, []]));
  /** @type {Map<string, string[]>} */
  const children = new Map(group.map((n) => [n.id, []]));
  for (const e of acyclic(group, edges)) {
    parents.get(e.from)?.push(e.to);
    children.get(e.to)?.push(e.from);
  }
  const rank = ranks(group, parents, children);
  const layers = /** @type {Node[][]} */ ([]);
  for (const n of group) {
    const r = rank.get(n.id) ?? 0;
    const layer = layers[r] ?? [];
    layer.push(n);
    layers[r] = layer;
  }
  const dense = layers.filter(Boolean);
  order(dense, edges);
  return coordinates(wrap(dense, group.length), edges);
}

/** The edges without those that close a cycle (found by a depth-first walk). */
function acyclic(/** @type {Node[]} */ group, /** @type {Edge[]} */ edges) {
  /** @type {Map<string, Edge[]>} */
  const out = new Map(group.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.from)?.push(e);
  const state = new Map();
  /** @type {Set<Edge>} */
  const back = new Set();
  for (const start of group) {
    if (state.has(start.id)) continue;
    /** @type {[string, number][]} */
    const stack = [[start.id, 0]];
    state.set(start.id, 1);
    while (stack.length) {
      const top = /** @type {[string, number]} */ (stack.at(-1));
      const list = out.get(top[0]) ?? [];
      if (top[1] >= list.length) {
        state.set(top[0], 2);
        stack.pop();
        continue;
      }
      const e = /** @type {Edge} */ (list[top[1]++]);
      const seen = state.get(e.to);
      if (seen === 1) back.add(e);
      else if (seen === undefined) {
        state.set(e.to, 1);
        stack.push([e.to, 0]);
      }
    }
  }
  return edges.filter((e) => !back.has(e));
}

/** Layers by the longest path from the referenced tables, then each pulled next to its children. */
function ranks(
  /** @type {Node[]} */ group,
  /** @type {Map<string, string[]>} */ parents,
  /** @type {Map<string, string[]>} */ children,
) {
  const left = new Map(group.map((n) => [n.id, parents.get(n.id)?.length ?? 0]));
  const queue = group.filter((n) => left.get(n.id) === 0).map((n) => n.id);
  /** @type {Map<string, number>} */
  const rank = new Map();
  const topo = [];
  for (let i = 0; i < queue.length; i++) {
    const id = /** @type {string} */ (queue[i]);
    topo.push(id);
    rank.set(id, Math.max(0, ...(parents.get(id) ?? []).map((p) => (rank.get(p) ?? 0) + 1)));
    for (const c of children.get(id) ?? []) {
      left.set(c, (left.get(c) ?? 1) - 1);
      if (left.get(c) === 0) queue.push(c);
    }
  }
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = /** @type {string} */ (topo[i]);
    const kids = children.get(id) ?? [];
    if (kids.length) rank.set(id, Math.min(...kids.map((c) => (rank.get(c) ?? 1) - 1)));
  }
  return rank;
}

/** Order each layer by the mean place of its neighbours, sweeping right then left. */
function order(/** @type {Node[][]} */ layers, /** @type {Edge[]} */ edges) {
  /** @type {Map<string, string[]>} */
  const near = new Map();
  for (const e of edges) {
    (near.get(e.from) ?? near.set(e.from, []).get(e.from))?.push(e.to);
    (near.get(e.to) ?? near.set(e.to, []).get(e.to))?.push(e.from);
  }
  /** @type {Map<string, number>} */
  const at = new Map();
  const number = () => {
    for (const layer of layers)
      for (const [i, n] of layer.entries()) at.set(n.id, i / Math.max(1, layer.length));
  };
  number();
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const list = sweep % 2 === 0 ? layers : [...layers].reverse();
    for (const layer of list) {
      const mean = new Map(
        layer.map((n, i) => {
          const marks = (near.get(n.id) ?? []).map((m) => at.get(m)).filter((v) => v !== undefined);
          const own = i / Math.max(1, layer.length);
          return [n.id, marks.length ? marks.reduce((s, v) => s + v, 0) / marks.length : own];
        }),
      );
      layer.sort((a, b) => (mean.get(a.id) ?? 0) - (mean.get(b.id) ?? 0));
      for (const [i, n] of layer.entries()) at.set(n.id, i / Math.max(1, layer.length));
    }
  }
}

/** A layer taller than the group allows is cut into columns side by side. */
function wrap(/** @type {Node[][]} */ layers, /** @type {number} */ size) {
  const most = Math.max(6, Math.ceil(Math.sqrt(size) * 1.5));
  return layers.flatMap((layer) => {
    const out = [];
    for (let i = 0; i < layer.length; i += most) out.push(layer.slice(i, i + most));
    return out;
  });
}

/** Columns of boxes, each box pulled toward its neighbours' height, the layers centred. */
function coordinates(/** @type {Node[][]} */ columns, /** @type {Edge[]} */ edges) {
  /** @type {Positions} */
  const at = new Map();
  let x = 0;
  const heights = columns.map((c) => c.reduce((s, n) => s + n.h, 0) + GAP_Y * (c.length - 1));
  const tallest = Math.max(...heights);
  columns.forEach((column, i) => {
    let y = ((tallest - (heights[i] ?? 0)) / 2) | 0;
    for (const n of column) {
      at.set(n.id, [x, y]);
      y += n.h + GAP_Y;
    }
    x += Math.max(...column.map((n) => n.w)) + GAP_X;
  });
  /** @type {Map<string, string[]>} */
  const near = new Map();
  for (const e of edges)
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ]) {
      const list = near.get(a);
      if (list) list.push(b);
      else near.set(a, [b]);
    }
  for (let pass = 0; pass < 2; pass++)
    for (const column of columns) {
      let floor = -Infinity;
      for (const n of column) {
        const pos = /** @type {[number, number]} */ (at.get(n.id));
        const mids = (near.get(n.id) ?? []).map((m) => {
          const p = at.get(m);
          return p ? p[1] : pos[1];
        });
        const want = mids.length
          ? (mids.sort((a, b) => a - b)[mids.length >> 1] ?? pos[1])
          : pos[1];
        const y = Math.max(floor, Math.round((pos[1] + want) / 2));
        at.set(n.id, [pos[0], y]);
        floor = y + n.h + GAP_Y;
      }
    }
  return normalised(at, columns.flat());
}

/** Lone tables on a grid, the tallest rows first. */
function grid(/** @type {Node[]} */ nodes) {
  const across = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  /** @type {Positions} */
  const at = new Map();
  let y = 0;
  for (let row = 0; row * across < nodes.length; row++) {
    const line = nodes.slice(row * across, (row + 1) * across);
    let x = 0;
    for (const n of line) {
      at.set(n.id, [x, y]);
      x += n.w + GAP_X / 2;
    }
    y += Math.max(...line.map((n) => n.h)) + GAP_Y;
  }
  return normalised(at, nodes);
}

/** A block's positions from (0, 0), with its size. */
function normalised(/** @type {Positions} */ at, /** @type {Node[]} */ nodes) {
  const minX = Math.min(...nodes.map((n) => at.get(n.id)?.[0] ?? 0));
  const minY = Math.min(...nodes.map((n) => at.get(n.id)?.[1] ?? 0));
  let w = 0;
  let h = 0;
  for (const n of nodes) {
    const [x, y] = /** @type {[number, number]} */ (at.get(n.id));
    at.set(n.id, [x - minX, y - minY]);
    w = Math.max(w, x - minX + n.w);
    h = Math.max(h, y - minY + n.h);
  }
  return { at, w, h };
}

/** Blocks in rows about as wide as the whole is tall, from (0, 0). */
function pack(/** @type {{ at: Positions, w: number, h: number }[]} */ blocks) {
  const area = blocks.reduce((s, b) => s + (b.w + GAP_X) * (b.h + GAP_Y), 0);
  const width = Math.max(Math.sqrt(area) * 1.6, ...blocks.map((b) => b.w));
  /** @type {Positions} */
  const out = new Map();
  let x = 0;
  let y = 0;
  let row = 0;
  for (const block of blocks) {
    if (x > 0 && x + block.w > width) {
      x = 0;
      y += row + GAP_Y * 2;
      row = 0;
    }
    for (const [id, [bx, by]] of block.at) out.set(id, [x + bx, y + by]);
    x += block.w + GAP_X;
    row = Math.max(row, block.h);
  }
  return out;
}
