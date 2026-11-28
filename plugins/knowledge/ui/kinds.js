// What the knowledge base is made of: the connector and schema it reads, the kinds of things a
// session links to, and how much each relation weighs (ADR 0404).

export const CONNECTOR = "desk.agent-sessions";
export const INSTANCE = "default";
export const SCHEMA = "https://endue.ai/specs/item/v0/agent-session.schema.json";

/** The scopes the plugin reads and manages with; plugin.json declares the same. */
export const READ = Object.freeze({
  permission: "data:read",
  kinds: ["record"],
  sources: [CONNECTOR],
});
export const MANAGE = Object.freeze({ permission: "connector:manage" });
export const NOTES_FOLDER = "~/.desk/knowledge";
export const WRITE = Object.freeze({ permission: "fs:write", paths: [`${NOTES_FOLDER}/**`] });

export const AGENTS = ["claude", "codex", "hermes"];
export const AGENT_NAMES = Object.freeze({
  claude: "Claude Code",
  codex: "Codex",
  hermes: "Hermes",
});
/** The chart token each agent's sessions are drawn in (the primary fill is for actions only). */
export const AGENT_TOKENS = Object.freeze({
  claude: "--desk-chart-1",
  codex: "--desk-chart-6",
  hermes: "--desk-chart-9",
});

/**
 * The kinds of things sessions link to, in the order the filters list them. `node`: drawn as a
 * node; a repository is a filter only, since most sessions of a repository share it (a hub).
 * @type {Readonly<Record<string, { label: string, one: string, token: string, node: boolean, notes: boolean }>>}
 */
export const KINDS = Object.freeze({
  ticket: { label: "Tickets", one: "Ticket", token: "--desk-text", node: true, notes: true },
  requirement: {
    label: "Requirement IDs",
    one: "Requirement",
    token: "--desk-chart-3",
    node: true,
    notes: true,
  },
  pr: {
    label: "Pull requests",
    one: "Pull request",
    token: "--desk-chart-8",
    node: true,
    notes: true,
  },
  issue: { label: "Issues", one: "Issue", token: "--desk-chart-5", node: true, notes: true },
  adr: { label: "ADRs", one: "ADR", token: "--desk-chart-2", node: true, notes: true },
  memory: {
    label: "Memory notes",
    one: "Memory note",
    token: "--desk-chart-10",
    node: true,
    notes: true,
  },
  file: { label: "Files", one: "File", token: "--desk-text-muted", node: true, notes: false },
  branch: { label: "Branches", one: "Branch", token: "--desk-chart-7", node: true, notes: false },
  repo: {
    label: "Repositories",
    one: "Repository",
    token: "--desk-text",
    node: false,
    notes: false,
  },
});

/** A relation's weight; a mention weighs by where it was found (PLACE_WEIGHT). */
export const REL_WEIGHT = Object.freeze({
  edited: 0.8,
  read: 0.2,
  wrote: 0.8,
  opened: 1,
  cites: 0.6,
  on: 0.7,
  in: 0.3,
  mentioned: 0.5,
});
export const PLACE_WEIGHT = Object.freeze({ prompt: 0.9, branch: 0.8, tool: 0.5, answer: 0.5 });

/** Settings, by short key, with their defaults (plugin.json declares the same). */
export const DEFAULTS = Object.freeze({
  /** Ticket-like prefixes that are not tickets (acceptance criteria AC-1, AC-2…). */
  ignore: "AC",
  /** A thing linked to more than this share of sessions, in percent, is a hub: a filter, not a node. */
  hub: 5,
  /** Things drawn as nodes are linked to at least this many sessions. */
  shared: 2,
});
