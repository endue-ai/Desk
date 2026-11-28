// The knowledge graph, derived from agent-session items and never edited (ADR 0404): sessions on
// one side, the things they touched on the other, each link weighed by its relation and each thing
// by how rare it is (IDF), so a file two sessions changed says more than a branch every session ran on.

import { DEFAULTS, KINDS, PLACE_WEIGHT, REL_WEIGHT, SCHEMA } from "./kinds.js";

/**
 * @typedef {{ entity: string, rel: string, where?: string, count: number, w: number }} Link
 * @typedef {{ id: string, agent: string, title: string, parent?: string, subagent: boolean,
 *   repo?: string, branch?: string, model?: string, startedAt?: string, updatedAt: string,
 *   day: number, turns: number, toolCalls: number, file: string, deepLink?: string,
 *   body: string, links: Link[], children: string[] }} Session
 * @typedef {{ id: string, kind: string, key: string, label: string, sessions: Set<string>,
 *   df: number, idf: number, hub: boolean }} Entity
 * @typedef {{ sessions: Map<string, Session>, entities: Map<string, Entity>, n: number,
 *   projects: Set<string> }} Graph
 * @typedef {{ ignore?: string, hub?: number }} GraphOptions
 */

/** Characters of a session's body kept for search and notes. */
const BODY = 2000;
/** A corpus smaller than this has no hubs: every thing is rare in it. */
const HUB_FLOOR = 20;
const DAY = 86_400_000;

/** `ACME-868` → `ACME`. */
export const prefixOf = (/** @type {string} */ key) => key.slice(0, key.lastIndexOf("-"));
/** The comma-separated list a setting holds. */
export const listOf = (/** @type {unknown} */ text) =>
  String(text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * The graph of `items`: those of the agent-session schema; others are left out.
 * @param {Iterable<any>} items
 * @param {GraphOptions} [options]
 * @returns {Graph}
 */
export function buildGraph(items, options = {}) {
  const records = [...items].filter((item) => item?.kind === "record" && item.schema === SCHEMA);
  const ignore = new Set(listOf(options.ignore ?? DEFAULTS.ignore));
  const projects = projectPrefixes(records);
  /** @type {Map<string, Session>} */
  const sessions = new Map();
  /** @type {Map<string, Entity>} */
  const entities = new Map();
  for (const item of records) {
    const session = sessionOf(item);
    for (const link of item.fields.links ?? []) {
      const kind = kindOf(link, projects, ignore);
      if (!kind) continue;
      const id = `${kind}:${link.key}`;
      let entity = entities.get(id);
      if (!entity) {
        entity = { id, kind, key: link.key, label: labelOf(kind, link.key), sessions: new Set() };
        entity.df = 0;
        entity.idf = 0;
        entity.hub = false;
        entities.set(id, /** @type {Entity} */ (entity));
      }
      entity.sessions.add(session.id);
      const w = weightOf(link);
      const held = session.links.find((l) => l.entity === id);
      if (!held)
        session.links.push({ entity: id, rel: link.rel, where: link.where, count: link.count, w });
      else if (w > held.w) Object.assign(held, { rel: link.rel, where: link.where, w });
    }
    sessions.set(session.id, session);
  }
  for (const session of sessions.values()) {
    const parent = session.parent ? sessions.get(session.parent) : undefined;
    parent?.children.push(session.id);
  }
  const n = sessions.size;
  const share = (options.hub ?? DEFAULTS.hub) / 100;
  for (const entity of entities.values()) {
    entity.df = entity.sessions.size;
    entity.idf = Math.log((n + 1) / entity.df);
    entity.hub = n >= HUB_FLOOR && entity.df / n > share;
  }
  return { sessions, entities, n, projects };
}

/** Prefixes that name a project's tickets: those in branch names (feat/ACME-868-…). */
function projectPrefixes(/** @type {any[]} */ records) {
  const found = new Set();
  for (const item of records)
    for (const link of item.fields.links ?? [])
      if (link.kind === "ticket" && (link.rel === "on" || link.where === "branch"))
        found.add(prefixOf(link.key));
  return found;
}

/** The entity kind of a link: a ticket key is a ticket, a requirement ID, or nothing. */
function kindOf(
  /** @type {any} */ link,
  /** @type {Set<string>} */ projects,
  /** @type {Set<string>} */ ignore,
) {
  if (link.kind !== "ticket") return KINDS[link.kind] ? link.kind : undefined;
  const prefix = prefixOf(link.key);
  if (ignore.has(prefix)) return undefined;
  return projects.has(prefix) ? "ticket" : "requirement";
}

function weightOf(/** @type {any} */ link) {
  if (link.rel === "mentioned" && link.where)
    return PLACE_WEIGHT[link.where] ?? REL_WEIGHT.mentioned;
  return REL_WEIGHT[link.rel] ?? 0.3;
}

/** @returns {Session} */
function sessionOf(/** @type {any} */ item) {
  const f = item.fields;
  const started = f.startedAt ?? item.createdAt ?? item.updatedAt;
  return {
    id: item.id,
    agent: f.agent,
    title: item.title,
    parent: f.parent,
    subagent: Boolean(f.subagent),
    repo: f.repo,
    branch: f.branch,
    model: f.model,
    startedAt: f.startedAt ?? item.createdAt,
    updatedAt: item.updatedAt,
    day: Math.floor(Date.parse(started) / DAY) || 0,
    turns: f.turns ?? 0,
    toolCalls: f.toolCalls ?? 0,
    file: f.file,
    deepLink: item.deepLink,
    body: String(item.body ?? "").slice(0, BODY),
    links: [],
    children: [],
  };
}

/**
 * How a thing is named on screen: a file by its name, a pull request as repo#number, an ADR by
 * its number and repository, a branch by its name, a repository by its folder.
 */
export function labelOf(/** @type {string} */ kind, /** @type {string} */ key) {
  const last = (/** @type {string} */ path) => path.split("/").filter(Boolean).at(-1) ?? path;
  switch (kind) {
    case "file":
    case "repo":
      return last(key);
    case "memory":
      return last(key).replace(/\.md$/, "");
    case "pr":
    case "issue": {
      const [path, number] = key.split("#");
      return `${last(path)}#${number}`;
    }
    case "adr": {
      const [name, repo] = key.split("@");
      return `${name.replace("-", " ")}${repo ? ` · ${last(repo)}` : ""}`;
    }
    case "branch":
      return key.slice(key.indexOf("@") + 1);
    default:
      return key;
  }
}

/** The repository a key belongs to, where it names one (files, branches, ADRs). */
export function repoOf(/** @type {Graph} */ graph, /** @type {string} */ id) {
  const entity = graph.entities.get(id);
  if (entity) {
    const sessions = [...entity.sessions].map((s) => graph.sessions.get(s)?.repo).filter(Boolean);
    const counts = new Map();
    for (const repo of sessions) counts.set(repo, (counts.get(repo) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  return graph.sessions.get(id)?.repo;
}

/** Every repository the sessions ran in, the busiest first: the repository filter. */
export function repositories(/** @type {Graph} */ graph) {
  const counts = new Map();
  for (const session of graph.sessions.values())
    if (session.repo) counts.set(session.repo, (counts.get(session.repo) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, sessions], _, all) => {
      const label = labelOf("repo", key);
      const twin = all.some(([other]) => other !== key && labelOf("repo", other) === label);
      // Two folders of one name: say the one above too (endue-os/endue-os).
      return { key, label: twin ? key.split("/").slice(-2).join("/") : label, sessions };
    });
}
