// One card model for every agent, without a DOM: the person's endue AI agents (studio.*, through
// studio-api.js) and the agent programs the core finds on this computer (agents.*, ADR 0110) come
// out as the same Card, with a source badge, a presence, a status line and a last activity, in one
// sort order: working first, then waiting for the person, online, paused, offline; then the most
// recently active; then by name.

/**
 * @typedef {import("./studio-api.js").EndueAgent} EndueAgent
 * @typedef {import("./studio-api.js").EndueConversation} EndueConversation
 * @typedef {import("./local-api.js").LocalAgent} LocalAgent
 * @typedef {import("./local-api.js").LocalAgentRun} LocalAgentRun
 * @typedef {"endue" | "local"} Source
 * @typedef {"working" | "waiting" | "online" | "paused" | "offline"} Presence
 * @typedef {object} Card
 * @property {string} key          `endue:<id>` or `local:<id>`, unique across both sources
 * @property {Source} source
 * @property {string} id           the agent's id in its source
 * @property {string} name
 * @property {string} role         what it does: its role, or for a program its vendor
 * @property {string} [handle]     `@slug` for an endue agent, the program's path for a local one
 * @property {string} [avatarUrl]
 * @property {string} initial      the letter the avatar shows without an image
 * @property {number} hue          1–8: the chart colour the avatar takes, stable per agent
 * @property {Presence} presence
 * @property {string} status       the presence in words, with what the agent is doing
 * @property {string} badge        "endue" or "Local"
 * @property {string} [lastActivity]  ISO time of the latest conversation, session or run
 * @property {boolean} runnable    a local program the desk can ask; an endue agent that is active
 */

export const PRESENCE_ORDER = /** @type {const} */ ([
  "working",
  "waiting",
  "online",
  "paused",
  "offline",
]);

export const PRESENCE_LABEL = {
  working: "Working",
  waiting: "Needs you",
  online: "Online",
  paused: "Paused",
  offline: "Offline",
};

export const BADGE = { endue: "endue", local: "Local" };

/** A stable 1–8 for `text`, so an agent keeps its colour. */
export function hueOf(/** @type {string} */ text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return (hash % 8) + 1;
}

const initialOf = (/** @type {string} */ name) => [...name.trim()][0]?.toUpperCase() ?? "?";

/** The newest of ISO times, or undefined. */
export function newest(/** @type {(string | undefined)[]} */ times) {
  let best;
  for (const time of times) if (time && (!best || Date.parse(time) > Date.parse(best))) best = time;
  return best;
}

/**
 * One endue agent's card; its conversations say whether it is working or waiting, and when it last
 * did something.
 * @param {EndueAgent} agent
 * @param {EndueConversation[]} conversations every conversation the Home read, any agent's
 * @returns {Card}
 */
export function endueCard(agent, conversations = []) {
  const own = conversations.filter((c) => c.agentId === agent.id);
  const running = own.find((c) => c.activity === "active");
  const waiting = own.some((c) => c.activity === "waiting");
  /** @type {Presence} */
  let presence =
    agent.status === "active" ? "online" : agent.status === "inactive" ? "paused" : "offline";
  // Only an agent that is on works or waits: a disabled one stays paused whatever its conversations say.
  if (presence === "online" && running) presence = "working";
  else if (presence === "online" && waiting) presence = "waiting";
  const doing = presence === "working" && running?.currentTool ? ` · ${running.currentTool}` : "";
  return {
    key: `endue:${agent.id}`,
    source: "endue",
    id: agent.id,
    name: agent.name || agent.slug || agent.id,
    role: agent.role ?? "",
    ...(agent.slug ? { handle: `@${agent.slug}` } : {}),
    ...(agent.avatarUrl ? { avatarUrl: agent.avatarUrl } : {}),
    initial: initialOf(agent.name || agent.slug || agent.id),
    hue: hueOf(agent.id),
    presence,
    status: `${PRESENCE_LABEL[presence]}${doing}`,
    badge: BADGE.endue,
    ...withTime(newest([agent.updatedAt, ...own.map((c) => c.updatedAt)])),
    runnable: agent.status === "active",
  };
}

/**
 * One local agent's card. A program found with no path to run it from is offline: its sessions are
 * read, but it cannot be asked.
 * @param {LocalAgent} agent
 * @param {{ runs?: LocalAgentRun[], lastSession?: string }} [seen] the core's runs; its newest session's time
 * @returns {Card}
 */
export function localCard(agent, seen = {}) {
  const runs = (seen.runs ?? []).filter((r) => r.agent === agent.id);
  const running = runs.filter((r) => r.state === "running").length || agent.running;
  /** @type {Presence} */
  const presence = running > 0 ? "working" : agent.program ? "online" : "offline";
  const status =
    presence === "working"
      ? `Working · ${running === 1 ? "1 run" : `${running} runs`}`
      : presence === "online"
        ? `Online${agent.version ? ` · ${agent.version}` : ""}`
        : "Offline · program not found";
  return {
    key: `local:${agent.id}`,
    source: "local",
    id: agent.id,
    name: agent.name,
    role: `${agent.vendor} · on this computer`,
    ...(agent.program ? { handle: agent.program } : {}),
    initial: initialOf(agent.name),
    hue: hueOf(agent.id),
    presence,
    status,
    badge: BADGE.local,
    ...withTime(newest([seen.lastSession, ...runs.map((r) => r.endedAt ?? r.startedAt)])),
    runnable: Boolean(agent.program),
  };
}

/** @param {string | undefined} time */
const withTime = (time) => (time ? { lastActivity: time } : {});

/** The order cards show in: presence, then the most recent activity, then the name. */
export function compareCards(/** @type {Card} */ a, /** @type {Card} */ b) {
  const rank = PRESENCE_ORDER.indexOf(a.presence) - PRESENCE_ORDER.indexOf(b.presence);
  if (rank) return rank;
  const at = (/** @type {Card} */ c) => (c.lastActivity ? Date.parse(c.lastActivity) : -Infinity);
  const recent = at(b) - at(a);
  if (recent) return recent > 0 ? 1 : -1;
  const named = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  return named || a.key.localeCompare(b.key);
}

/**
 * Every agent as one sorted list of cards.
 * @param {object} input
 * @param {EndueAgent[]} [input.endue]
 * @param {EndueConversation[]} [input.conversations]
 * @param {LocalAgent[]} [input.local]
 * @param {LocalAgentRun[]} [input.runs]
 * @param {Record<string, string | undefined>} [input.lastSessions] each local agent's newest session time
 * @returns {Card[]}
 */
export function buildCards({
  endue = [],
  conversations = [],
  local = [],
  runs = [],
  lastSessions = {},
}) {
  return [
    ...endue.map((agent) => endueCard(agent, conversations)),
    ...local.map((agent) => localCard(agent, { runs, lastSession: lastSessions[agent.id] })),
  ].sort(compareCards);
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", or the date, for people. */
export function ago(
  /** @type {string | undefined} */ time,
  /** @type {number} */ now = Date.now(),
) {
  if (!time) return "";
  const then = Date.parse(time);
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(then).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
