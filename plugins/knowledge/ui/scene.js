// From the drawn part of the graph to what the layout takes and what the canvas draws: node order,
// edge index pairs and pulls, charges, sizes, colours and labels.

import { tokenOf } from "./canvas.js";

/**
 * @typedef {import("./graph.js").Graph} Graph
 * @typedef {import("./query.js").Drawn} Drawn
 * @typedef {import("./canvas.js").Scene} Scene
 */

const SESSION_LABEL = 48;

/** The drawn nodes in a stable order: things first, then sessions, each by id. */
export function order(/** @type {Graph} */ graph, /** @type {Drawn} */ drawn) {
  const ids = [...drawn.nodes];
  const thing = (/** @type {string} */ id) => (graph.entities.has(id) ? 0 : 1);
  return ids.sort((a, b) => thing(a) - thing(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The layout's input for the drawn graph; `previous` positions by id seed the nodes it knew.
 * @returns {import("./layout.js").LayoutInput & { ids: string[] }}
 */
export function layoutInput(
  /** @type {Graph} */ graph,
  /** @type {Drawn} */ drawn,
  /** @type {Map<string, [number, number]>} */ previous = new Map(),
) {
  const ids = order(graph, drawn);
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges = new Int32Array(drawn.edges.length * 2);
  const weights = new Float32Array(drawn.edges.length);
  drawn.edges.forEach(([a, b, spawned], e) => {
    edges[2 * e] = /** @type {number} */ (index.get(a));
    edges[2 * e + 1] = /** @type {number} */ (index.get(b));
    const link = graph.sessions.get(a)?.links.find((l) => l.entity === b);
    weights[e] = spawned ? 1 : (link?.w ?? 0.5);
  });
  const mass = new Float32Array(ids.length);
  const start = new Float32Array(ids.length * 2).fill(Number.NaN);
  ids.forEach((id, i) => {
    const entity = graph.entities.get(id);
    mass[i] = entity ? 1 + Math.sqrt(entity.df) : 1;
    const seen = previous.get(id);
    if (seen) [start[2 * i], start[2 * i + 1]] = seen;
  });
  return { ids, n: ids.length, edges, weights, mass, start };
}

/** A node's radius: a thing grows with the sessions it links, a subagent is smaller. */
export function radiusOf(/** @type {Graph} */ graph, /** @type {string} */ id) {
  const entity = graph.entities.get(id);
  if (entity) return Math.min(14, 3 + Math.sqrt(entity.df) * 1.2);
  return graph.sessions.get(id)?.subagent ? 1.6 : 2.4;
}

/**
 * The scene for `ids` laid out at `positions` ([x0, y0, x1, y1, …] in `ids` order).
 * @returns {Scene}
 */
export function sceneOf(
  /** @type {Graph} */ graph,
  /** @type {Drawn} */ drawn,
  /** @type {string[]} */ ids,
  /** @type {Float32Array} */ positions,
) {
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const r = new Float32Array(n);
  const kinds = [];
  const labels = [];
  const tokens = [];
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    x[i] = positions[2 * i] ?? 0;
    y[i] = positions[2 * i + 1] ?? 0;
    r[i] = radiusOf(graph, id);
    const entity = graph.entities.get(id);
    const session = graph.sessions.get(id);
    kinds.push(entity ? entity.kind : "session");
    tokens.push(tokenOf(entity ? entity.kind : "session", session?.agent));
    const title = session?.title ?? "";
    labels.push(
      entity
        ? entity.label
        : title.length > SESSION_LABEL
          ? `${title.slice(0, SESSION_LABEL)}…`
          : title,
    );
  }
  const edges = new Int32Array(drawn.edges.length * 2);
  const spawned = new Uint8Array(drawn.edges.length);
  drawn.edges.forEach(([a, b, parent], e) => {
    edges[2 * e] = index.get(a) ?? 0;
    edges[2 * e + 1] = index.get(b) ?? 0;
    spawned[e] = parent ? 1 : 0;
  });
  return { ids, kinds, labels, tokens, x, y, r, edges, spawned, index };
}

/** Positions by id, to seed the next layout. */
export function positionsOf(/** @type {Scene} */ scene) {
  /** @type {Map<string, [number, number]>} */
  const map = new Map();
  for (let i = 0; i < scene.ids.length; i++) map.set(scene.ids[i], [scene.x[i], scene.y[i]]);
  return map;
}
