// What the screen shows, as plain data the view draws: the details of the selected node, the
// days sessions ran on, the counts beside each filter. No DOM here, so the tests read it as is.

import { AGENT_NAMES, AGENT_TOKENS, AGENTS, KINDS } from "./kinds.js";
import { alike, sessionsOf, together } from "./query.js";

/**
 * @typedef {import("./graph.js").Graph} Graph
 * @typedef {import("./graph.js").Session} Session
 * @typedef {{ id: string, label: string, token: string, note: string }} Row
 * @typedef {{ kind: string, title: string, subtitle: string, stats: Array<[string, string]>,
 *   agents: Record<string, number>, together: Row[], sessions: Row[], alike: Row[],
 *   parent?: Row, noted: boolean }} Panel
 */

const DAY = 86_400_000;
/** Days the timeline shows at most, ending on the latest. */
const TIMELINE_DAYS = 60;

const day = (/** @type {number} */ d) =>
  new Date(d * DAY).toISOString().slice(5, 10).replace("-", "/");
const agentToken = (/** @type {string} */ agent) =>
  AGENT_TOKENS[/** @type {keyof typeof AGENT_TOKENS} */ (agent)] ?? "--desk-text-muted";

/** A session as a row: its agent's colour, its title, its date. */
function sessionRow(/** @type {Session} */ s) {
  return {
    id: s.id,
    label: s.title,
    token: agentToken(s.agent),
    note: `${day(s.day)}${s.subagent ? " · sub" : ""}`,
  };
}

/** @returns {Panel | undefined} */
export function panelFor(/** @type {Graph} */ graph, /** @type {string | null} */ id) {
  if (!id) return undefined;
  const entity = graph.entities.get(id);
  const session = graph.sessions.get(id);
  if (!entity && !session) return undefined;
  const sessions = sessionsOf(graph, id);
  /** @type {Record<string, number>} */
  const agents = {};
  for (const s of sessions) agents[s.agent] = (agents[s.agent] ?? 0) + 1;
  const days = new Set(sessions.map((s) => s.day));
  const first = Math.min(...days);
  const last = Math.max(...days);
  const span = days.size ? `${day(first)}–${day(last)}` : "";
  const rows = together(graph, id, 10).map(({ entity: e, shared }) => ({
    id: e.id,
    label: e.kind === "file" ? e.key.replace(/^~\/[^/]+\/[^/]+\//, "") : e.label,
    token: KINDS[e.kind]?.token ?? "--desk-text-muted",
    note: session ? (KINDS[e.kind]?.one ?? e.kind) : `${shared}×`,
  }));
  if (entity) {
    const kind = KINDS[entity.kind];
    return {
      kind: kind?.one ?? entity.kind,
      title: entity.kind === "file" ? entity.key : entity.label,
      subtitle: [entity.label !== entity.key ? entity.key : "", span].filter(Boolean).join(" · "),
      stats: [
        ["Sessions", String(sessions.length)],
        ["Days", String(days.size)],
        ["Linked", String(rows.length)],
      ],
      agents,
      together: rows,
      sessions: sessions
        .filter((s) => !s.subagent)
        .slice(0, 10)
        .map(sessionRow),
      alike: [],
      noted: Boolean(kind?.notes),
    };
  }
  const s = /** @type {Session} */ (session);
  const parent = s.parent ? graph.sessions.get(s.parent) : undefined;
  return {
    kind: `${AGENT_NAMES[s.agent] ?? s.agent} session${s.subagent ? " · subagent" : ""}`,
    title: s.title,
    subtitle: [day(s.day), s.repo, s.branch].filter(Boolean).join(" · "),
    stats: [
      ["Prompts", String(s.turns)],
      ["Tool calls", String(s.toolCalls)],
      ["Subagents", String(s.children.length)],
    ],
    agents,
    together: rows,
    sessions: s.children
      .map((c) => graph.sessions.get(c))
      .filter((c) => c !== undefined)
      .slice(0, 10)
      .map(sessionRow),
    alike: alike(graph, s.id, 6).map(({ session: o }) => sessionRow(o)),
    parent: parent ? sessionRow(parent) : undefined,
    noted: true,
  };
}

/**
 * Sessions per day and agent over the latest days, and whether the selection was worked on then.
 * @returns {Array<{ label: string, counts: Record<string, number>, hot: boolean }>}
 */
export function timeline(
  /** @type {Graph} */ graph,
  /** @type {Set<string>} */ shown,
  /** @type {string | null} */ selected,
) {
  const sessions = [...graph.sessions.values()].filter((s) => shown.has(s.id));
  if (!sessions.length) return [];
  const last = Math.max(...sessions.map((s) => s.day));
  const first = Math.max(Math.min(...sessions.map((s) => s.day)), last - TIMELINE_DAYS + 1);
  const hot = new Set(selected ? sessionsOf(graph, selected).map((s) => s.day) : []);
  const days = [];
  for (let d = first; d <= last; d++) {
    /** @type {Record<string, number>} */
    const counts = Object.fromEntries(AGENTS.map((a) => [a, 0]));
    days.push({ label: day(d), counts, hot: !selected || hot.has(d) });
  }
  for (const s of sessions) {
    const at = days[s.day - first];
    if (at) at.counts[s.agent] = (at.counts[s.agent] ?? 0) + 1;
  }
  return days;
}

/** How many sessions each agent ran and how many things of each kind there are. */
export function counts(/** @type {Graph} */ graph) {
  /** @type {Record<string, number>} */
  const agents = Object.fromEntries(AGENTS.map((a) => [a, 0]));
  for (const s of graph.sessions.values()) agents[s.agent] = (agents[s.agent] ?? 0) + 1;
  /** @type {Record<string, number>} */
  const kinds = Object.fromEntries(Object.keys(KINDS).map((k) => [k, 0]));
  for (const e of graph.entities.values()) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  return { agents, kinds };
}

/** A note as the note view shows it: no front matter, [[links]] as their labels in bold. */
export function readable(/** @type {string} */ markdown) {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n+/, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "**$2**")
    .replace(/\[\[([^\]]+)\]\]/g, "**$1**");
}
