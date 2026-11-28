// Questions the graph answers: what is drawn under the filters, what lies around a node, what
// came up together with a thing, which sessions are alike, and what a name or a path refers to.

import { KINDS } from "./kinds.js";

/**
 * @typedef {import("./graph.js").Graph} Graph
 * @typedef {import("./graph.js").Entity} Entity
 * @typedef {import("./graph.js").Session} Session
 * @typedef {{ agents: Record<string, boolean>, kinds: Record<string, boolean>, subagents: boolean,
 *   orphans: boolean, shared: number, repo: string }} Filters
 * @typedef {{ nodes: Set<string>, edges: Array<[string, string, boolean]> }} Drawn
 */

/** Whether an entity is a node under the filters: not a hub, of a drawn kind, shared enough. */
export function drawsEntity(/** @type {Entity} */ entity, /** @type {Filters} */ filters) {
  const kind = KINDS[entity.kind];
  return Boolean(
    kind?.node &&
      !entity.hub &&
      filters.kinds[entity.kind] !== false &&
      entity.df >= filters.shared,
  );
}

/**
 * The nodes and edges drawn under the filters: sessions of the chosen agents and repository,
 * the things they share, a subagent's edge to its parent (marked `true`).
 * @returns {Drawn}
 */
export function visible(/** @type {Graph} */ graph, /** @type {Filters} */ filters) {
  /** @type {Set<string>} */
  const nodes = new Set();
  /** @type {Drawn["edges"]} */
  const edges = [];
  const shown = (/** @type {Session} */ s) =>
    filters.agents[s.agent] !== false &&
    (filters.subagents || !s.subagent) &&
    (filters.repo === "" || s.repo === filters.repo);
  for (const session of graph.sessions.values()) {
    if (!shown(session)) continue;
    let linked = false;
    for (const link of session.links) {
      const entity = graph.entities.get(link.entity);
      if (!entity || !drawsEntity(entity, filters)) continue;
      nodes.add(entity.id);
      edges.push([session.id, entity.id, false]);
      linked = true;
    }
    const parent = session.parent ? graph.sessions.get(session.parent) : undefined;
    if (parent && shown(parent)) {
      edges.push([session.id, parent.id, true]);
      nodes.add(parent.id);
      linked = true;
    }
    if (linked || filters.orphans) nodes.add(session.id);
  }
  return { nodes, edges: edges.filter(([a, b]) => nodes.has(a) && nodes.has(b)) };
}

/** The nodes within `depth` edges of `id` among the drawn ones. */
export function around(/** @type {Drawn} */ drawn, /** @type {string} */ id, depth = 2) {
  /** @type {Map<string, string[]>} */
  const next = new Map();
  const add = (/** @type {string} */ from, /** @type {string} */ to) => {
    const list = next.get(from);
    if (list) list.push(to);
    else next.set(from, [to]);
  };
  for (const [a, b] of drawn.edges) {
    add(a, b);
    add(b, a);
  }
  const seen = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    frontier = frontier.flatMap((at) => next.get(at) ?? []).filter((at) => !seen.has(at));
    for (const at of frontier) seen.add(at);
  }
  return {
    nodes: seen,
    edges: drawn.edges.filter(([a, b]) => seen.has(a) && seen.has(b)),
  };
}

/** The sessions of a thing, or a session with its subagents, the latest first. */
export function sessionsOf(/** @type {Graph} */ graph, /** @type {string} */ id) {
  const entity = graph.entities.get(id);
  const session = graph.sessions.get(id);
  const ids = entity ? [...entity.sessions] : session ? [id, ...session.children] : [];
  return ids
    .map((s) => graph.sessions.get(s))
    .filter((s) => s !== undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The things that came up with `id`, strongest first: for a thing, those its sessions touched,
 * each counted once per session and weighed by link and rarity; for a session, its own links.
 * @returns {Array<{ entity: Entity, score: number, shared: number }>}
 */
export function together(/** @type {Graph} */ graph, /** @type {string} */ id, limit = 12) {
  /** @type {Map<string, { score: number, shared: number }>} */
  const scores = new Map();
  for (const session of sessionsOf(graph, id)) {
    for (const link of session.links) {
      const entity = graph.entities.get(link.entity);
      if (!entity || entity.id === id || entity.hub || entity.kind === "repo") continue;
      const held = scores.get(entity.id) ?? { score: 0, shared: 0 };
      held.score += link.w * entity.idf;
      held.shared += 1;
      scores.set(entity.id, held);
    }
  }
  return [...scores]
    .map(([eid, s]) => ({ entity: /** @type {Entity} */ (graph.entities.get(eid)), ...s }))
    .sort((a, b) => b.score - a.score || a.entity.key.localeCompare(b.entity.key))
    .slice(0, limit);
}

/**
 * Sessions alike to a session: the rare things both touched, each weighed by both links.
 * @returns {Array<{ session: Session, score: number }>}
 */
export function alike(/** @type {Graph} */ graph, /** @type {string} */ id, limit = 8) {
  const session = graph.sessions.get(id);
  if (!session) return [];
  /** @type {Map<string, number>} */
  const scores = new Map();
  for (const link of session.links) {
    const entity = graph.entities.get(link.entity);
    if (!entity || entity.hub || entity.kind === "repo") continue;
    for (const other of entity.sessions) {
      if (other === id || other === session.parent || session.children.includes(other)) continue;
      const theirs = graph.sessions.get(other)?.links.find((l) => l.entity === entity.id);
      scores.set(other, (scores.get(other) ?? 0) + link.w * (theirs?.w ?? 0) * entity.idf);
    }
  }
  return [...scores]
    .map(([sid, score]) => ({ session: /** @type {Session} */ (graph.sessions.get(sid)), score }))
    .sort((a, b) => b.score - a.score || b.session.updatedAt.localeCompare(a.session.updatedAt))
    .slice(0, limit);
}

/**
 * What a name refers to: an entity or session id, a key of any kind (a ticket key, a `~` path, a
 * pull request), or the end of a file path (`plugins/notes/ui/main.js`).
 * @returns {string | undefined} the id
 */
export function resolve(/** @type {Graph} */ graph, /** @type {string} */ name) {
  const text = String(name ?? "").trim();
  if (!text) return undefined;
  if (graph.entities.has(text) || graph.sessions.has(text)) return text;
  const byKey = [...graph.entities.values()].filter(
    (e) => e.key === text || e.key === text.toUpperCase(),
  );
  if (byKey.length) return byKey.sort((a, b) => b.df - a.df)[0].id;
  const session = [...graph.sessions.keys()].find((sid) => sid.endsWith(`:${text}`));
  if (session) return session;
  const tail = text.replace(/^\.?\//, "");
  if (!tail.includes("/")) return undefined;
  const files = [...graph.entities.values()].filter(
    (e) => (e.kind === "file" || e.kind === "memory") && e.key.endsWith(`/${tail}`),
  );
  return files.sort((a, b) => b.df - a.df)[0]?.id;
}

/**
 * Things and sessions whose name holds every word of `text`, the best first: an exact key, then
 * a key that starts so, then the most linked.
 */
export function search(
  /** @type {Graph} */ graph,
  /** @type {string} */ text,
  /** @type {{ kinds?: string[], limit?: number }} */ options = {},
) {
  const words = String(text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const limit = options.limit ?? 20;
  if (!words.length) return { entities: [], sessions: [] };
  const holds = (/** @type {string} */ hay) => words.every((w) => hay.includes(w));
  const rank = (/** @type {Entity} */ e) => {
    const key = e.key.toLowerCase();
    const whole = words.join(" ");
    return key === whole
      ? 0
      : key.startsWith(whole) || e.label.toLowerCase().startsWith(whole)
        ? 1
        : 2;
  };
  const entities = [...graph.entities.values()]
    .filter((e) => !options.kinds?.length || options.kinds.includes(e.kind))
    .filter((e) => holds(`${e.key} ${e.label}`.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b) || b.df - a.df || a.key.localeCompare(b.key))
    .slice(0, limit);
  const sessions =
    options.kinds?.length && !options.kinds.includes("session")
      ? []
      : [...graph.sessions.values()]
          .filter((s) => holds(`${s.title} ${s.id}`.toLowerCase()))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, limit);
  return { entities, sessions };
}
