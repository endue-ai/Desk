// Notes: one Markdown file per thing worth a page (a ticket, a pull request, an ADR, a memory
// note), made from the graph alone, deterministically: the same sessions write the same bytes.
// Notes link each other as [[name]], so any editor that follows wiki links opens the folder too.
// A note is regenerated, never edited: its front matter says so.

import { AGENT_NAMES, KINDS, NOTES_FOLDER } from "./kinds.js";
import { sessionsOf, together } from "./query.js";

/**
 * @typedef {import("./graph.js").Graph} Graph
 * @typedef {import("./graph.js").Entity} Entity
 * @typedef {{ path: string, name: string, markdown: string }} Note
 */

/** Notes written at most by one `write-notes`, the most linked things first. */
export const NOTE_LIMIT = 300;
const SESSIONS_LISTED = 30;

/** The note's file name without `.md`: the key made safe, its kind in front but for tickets. */
export function noteName(/** @type {Entity} */ entity) {
  const safe = entity.key
    .replace(/^~\//, "")
    .replace(/[^A-Za-z0-9._@#-]+/g, "-")
    .replace(/#/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return entity.kind === "ticket" ? safe : `${entity.kind}-${safe}`;
}

/** `2026-11-04T08:20:00Z` → `2026-11-04`. */
const date = (/** @type {string | undefined} */ at) => (at ?? "").slice(0, 10);

/** Text that cannot break out of a Markdown link label or table cell. */
const plain = (/** @type {string} */ text) => text.replace(/[[\]|`<>\n\r]+/g, " ").trim();

/**
 * The note of a thing, or of a session.
 * @returns {Note | undefined}
 */
export function noteFor(/** @type {Graph} */ graph, /** @type {string} */ id) {
  const entity = graph.entities.get(id);
  if (entity) return entityNote(graph, entity);
  const session = graph.sessions.get(id);
  if (!session) return undefined;
  const lines = [
    "---",
    `session: ${session.id}`,
    `agent: ${session.agent}`,
    `started: ${session.startedAt ?? ""}`,
    `updated: ${session.updatedAt}`,
    "---",
    "",
    `# ${plain(session.title)}`,
    "",
    `${AGENT_NAMES[session.agent] ?? session.agent} · ${session.repo ?? "no folder"}${session.branch ? ` · ${session.branch}` : ""} · ${session.turns} prompts`,
    "",
  ];
  const links = together(graph, id, 40);
  if (links.length) {
    lines.push("## Touched", "");
    for (const { entity: e } of links) lines.push(`- ${reference(e)}`);
    lines.push("");
  }
  if (session.body) lines.push("## What was asked", "", session.body, "");
  const name = `session-${session.id.replace(/[^A-Za-z0-9-]+/g, "-")}`;
  return { name, path: `${NOTES_FOLDER}/${name}.md`, markdown: lines.join("\n") };
}

/** `[[note]]` for a thing that has notes, else its key in code. */
function reference(/** @type {Entity} */ entity) {
  const kind = KINDS[entity.kind];
  if (kind?.notes) return `[[${noteName(entity)}|${plain(entity.label)}]]`;
  return `\`${plain(entity.key)}\` (${kind?.one.toLowerCase() ?? entity.kind})`;
}

/** @returns {Note} */
function entityNote(/** @type {Graph} */ graph, /** @type {Entity} */ entity) {
  const sessions = sessionsOf(graph, entity.id);
  const agents = new Map();
  for (const s of sessions) agents.set(s.agent, (agents.get(s.agent) ?? 0) + 1);
  const days = sessions
    .map((s) => date(s.startedAt ?? s.updatedAt))
    .filter(Boolean)
    .sort();
  const kind = KINDS[entity.kind];
  const lines = [
    "---",
    `kind: ${entity.kind}`,
    `key: "${entity.key.replace(/"/g, "'")}"`,
    `sessions: ${sessions.length}`,
    ...[...agents].sort().map(([agent, n]) => `${agent}: ${n}`),
    `first: ${days[0] ?? ""}`,
    `last: ${days.at(-1) ?? ""}`,
    "generated: endue.knowledge from desk.agent-sessions; edits are overwritten",
    "---",
    "",
    `# ${plain(entity.label)}`,
    "",
    `${kind?.one ?? entity.kind} \`${plain(entity.key)}\`, in ${sessions.length} sessions from ${days[0] ?? "?"} to ${days.at(-1) ?? "?"}.`,
    "",
    "## Sessions",
    "",
  ];
  for (const s of sessions.slice(0, SESSIONS_LISTED)) {
    const who = AGENT_NAMES[s.agent] ?? s.agent;
    const title = s.deepLink ? `[${plain(s.title)}](${s.deepLink})` : plain(s.title);
    lines.push(
      `- ${date(s.startedAt ?? s.updatedAt)} · ${who}${s.subagent ? " (subagent)" : ""} · ${title}`,
    );
  }
  if (sessions.length > SESSIONS_LISTED)
    lines.push(`- … and ${sessions.length - SESSIONS_LISTED} more`);
  const related = together(graph, entity.id, 40);
  const group = (/** @type {string[]} */ kinds, /** @type {string} */ heading) => {
    const found = related.filter((r) => kinds.includes(r.entity.kind));
    if (!found.length) return;
    lines.push("", `## ${heading}`, "");
    for (const r of found) lines.push(`- ${reference(r.entity)} · ${r.shared} sessions`);
  };
  group(["file", "memory"], "Files");
  group(["pr", "issue", "branch"], "Pull requests and branches");
  group(["ticket", "requirement", "adr"], "Related");
  lines.push("");
  const name = noteName(entity);
  return { name, path: `${NOTES_FOLDER}/${name}.md`, markdown: lines.join("\n") };
}

/** The things that get a note, the most linked first, `NOTE_LIMIT` at most. */
export function noteworthy(/** @type {Graph} */ graph) {
  return [...graph.entities.values()]
    .filter((e) => KINDS[e.kind]?.notes)
    .sort((a, b) => b.df - a.df || a.key.localeCompare(b.key))
    .slice(0, NOTE_LIMIT);
}

/** `index.md`: every noted thing by kind, linked. */
export function indexNote(/** @type {Graph} */ graph, /** @type {Entity[]} */ noted) {
  const lines = [
    "---",
    "generated: endue.knowledge from desk.agent-sessions; edits are overwritten",
    `sessions: ${graph.n}`,
    "---",
    "",
    "# Agent sessions",
    "",
    `${graph.n} sessions, ${graph.entities.size} things they touched.`,
  ];
  for (const [kind, info] of Object.entries(KINDS)) {
    const of = noted.filter((e) => e.kind === kind);
    if (!of.length) continue;
    lines.push("", `## ${info.label}`, "");
    for (const e of of) lines.push(`- ${reference(e)} · ${e.df} sessions`);
  }
  lines.push("");
  return { name: "index", path: `${NOTES_FOLDER}/index.md`, markdown: lines.join("\n") };
}
