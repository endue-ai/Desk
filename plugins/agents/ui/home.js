// The Home, without a DOM: the card grid's filter chips (by source and by status) and search, and
// the activity board, the web's Activity page: every conversation in Waiting · Active · Failed ·
// Done, filtered by agent chips. Endue conversations come from studio.*; a local agent's sessions
// and the core's runs are its conversations.

import { BADGE, PRESENCE_LABEL, PRESENCE_ORDER } from "./cards.js";

/**
 * @typedef {import("./cards.js").Card} Card
 * @typedef {import("./cards.js").Source} Source
 * @typedef {import("./cards.js").Presence} Presence
 * @typedef {import("./studio-api.js").EndueConversation} EndueConversation
 * @typedef {import("./local-api.js").LocalAgentSession} LocalAgentSession
 * @typedef {import("./local-api.js").LocalAgentRun} LocalAgentRun
 * @typedef {{ source: "all" | Source, status: "all" | Presence, query: string }} Filters
 * @typedef {{ id: string, label: string, count: number }} Chip
 * @typedef {"waiting" | "active" | "failed" | "done"} Column
 * @typedef {object} Row
 * @property {string} key
 * @property {Source} source
 * @property {string} agentKey
 * @property {string} agentName
 * @property {string} title
 * @property {string} preview      the running tool, the failure, or the last message
 * @property {Column} column
 * @property {string} at           ISO time of its last activity
 * @property {number} [count]      how many messages it holds
 * @property {string} [runId]      a local run going on, which Stop ends
 * @property {string} [sessionId]  a local session, which opens in the agent's chat
 * @property {string} [conversationId]
 * @typedef {{ label: string, rows: Row[] }} Group
 * @typedef {{ id: Column, label: string, rows: Row[], count: number, attention: boolean, groups?: Group[] }} BoardColumn
 */

export const COLUMNS = /** @type {const} */ ({
  waiting: "Waiting",
  active: "Active",
  failed: "Failed",
  done: "Done",
});

/** Lower-case words of `text`, for search. */
const words = (/** @type {string} */ text) => text.toLowerCase().split(/\s+/).filter(Boolean);

/** Whether `card` holds every word of `query` in its name, role, handle, badge or status. */
export function matches(/** @type {Card} */ card, /** @type {string} */ query) {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const hay = [card.name, card.role, card.handle ?? "", card.badge, card.status]
    .join(" ")
    .toLowerCase();
  return wanted.every((word) => hay.includes(word));
}

/** The cards the filters keep, in their order. */
export function filterCards(/** @type {Card[]} */ cards, /** @type {Filters} */ filters) {
  return cards.filter(
    (card) =>
      (filters.source === "all" || card.source === filters.source) &&
      (filters.status === "all" || card.presence === filters.status) &&
      matches(card, filters.query),
  );
}

/** All, endue and Local, each with how many cards it would show under the other filters. */
export function sourceChips(/** @type {Card[]} */ cards, /** @type {Filters} */ filters) {
  const shown = filterCards(cards, { ...filters, source: "all" });
  return /** @type {Chip[]} */ ([
    { id: "all", label: "All", count: shown.length },
    { id: "endue", label: BADGE.endue, count: shown.filter((c) => c.source === "endue").length },
    { id: "local", label: BADGE.local, count: shown.filter((c) => c.source === "local").length },
  ]);
}

/** All, then each status some card has, in presence order, with its count. */
export function statusChips(/** @type {Card[]} */ cards, /** @type {Filters} */ filters) {
  const shown = filterCards(cards, { ...filters, status: "all" });
  return /** @type {Chip[]} */ ([
    { id: "all", label: "Any status", count: shown.length },
    ...PRESENCE_ORDER.map((p) => ({
      id: p,
      label: PRESENCE_LABEL[p],
      count: shown.filter((c) => c.presence === p).length,
    })).filter((chip) => chip.count > 0 || chip.id === filters.status),
  ]);
}

/**
 * The board's rows for endue conversations whose agent has a card, each in the column the core
 * sorted it into (the web's statusOf: running, failed, waiting for the person, else done).
 */
export function endueRows(
  /** @type {EndueConversation[]} */ conversations,
  /** @type {Card[]} */ cards,
) {
  const names = new Map(cards.filter((c) => c.source === "endue").map((c) => [c.id, c.name]));
  return conversations.flatMap((c) => {
    const agentName = names.get(c.agentId);
    if (agentName === undefined) return [];
    const column = c.activity;
    const preview =
      column === "active" && c.currentTool
        ? `Using ${c.currentTool}`
        : column === "failed"
          ? `Failed${c.errorCode ? `: ${c.errorCode}` : ""}`
          : c.preview;
    return [
      /** @type {Row} */ ({
        key: `endue:${c.id}`,
        source: "endue",
        agentKey: `endue:${c.agentId}`,
        agentName,
        title: c.title || "New conversation",
        preview,
        column,
        at: c.updatedAt,
        count: c.messageCount,
        conversationId: c.id,
      }),
    ];
  });
}

/**
 * The board's rows for local agents: each session is a conversation, Active while a run of it goes
 * on and Failed when its last run failed; a run whose session is not listed yet is a row of its own.
 * @param {Record<string, LocalAgentSession[]>} sessions by agent id
 * @param {LocalAgentRun[]} runs the core's runs, the newest first
 * @param {Card[]} cards
 */
export function localRows(sessions, runs, cards) {
  const names = new Map(cards.filter((c) => c.source === "local").map((c) => [c.id, c.name]));
  /** @type {Row[]} */
  const rows = [];
  const claimed = new Set();
  for (const [agent, list] of Object.entries(sessions)) {
    const agentName = names.get(agent);
    if (agentName === undefined) continue;
    for (const session of list) {
      const own = runs.filter((r) => r.agent === agent && r.sessionId === session.id);
      for (const run of own) claimed.add(run.runId);
      const running = own.find((r) => r.state === "running");
      const last = own[0];
      /** @type {Column} */
      const column = running ? "active" : last?.state === "failed" ? "failed" : "done";
      rows.push({
        key: `local:${agent}:${session.id}`,
        source: "local",
        agentKey: `local:${agent}`,
        agentName,
        title: session.title || "Untitled session",
        preview:
          column === "failed"
            ? `Failed: ${last?.error ?? "the program stopped"}`
            : (running?.prompt ?? session.cwd ?? ""),
        column,
        at: newer(session.updatedAt, last?.endedAt ?? last?.startedAt),
        sessionId: session.id,
        ...(running ? { runId: running.runId } : {}),
      });
    }
  }
  for (const run of runs) {
    const agentName = names.get(run.agent);
    if (claimed.has(run.runId) || agentName === undefined) continue;
    rows.push({
      key: `local:${run.agent}:${run.runId}`,
      source: "local",
      agentKey: `local:${run.agent}`,
      agentName,
      title: run.prompt,
      preview: run.state === "failed" ? `Failed: ${run.error ?? "the program stopped"}` : run.text,
      column: run.state === "running" ? "active" : run.state === "failed" ? "failed" : "done",
      at: run.endedAt ?? run.startedAt,
      ...(run.sessionId ? { sessionId: run.sessionId } : {}),
      ...(run.state === "running" ? { runId: run.runId } : {}),
    });
  }
  return rows;
}

const newer = (/** @type {string} */ a, /** @type {string | undefined} */ b) =>
  b && Date.parse(b) > Date.parse(a) ? b : a;

/** "Today", "Yesterday", "This week" or "Earlier", in the local day. */
export function bucketOf(/** @type {string} */ at, /** @type {number} */ now) {
  const day = (/** @type {number} */ t) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(Date.parse(at))) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

/**
 * The four columns, newest first in each, keeping only the agents chosen (none chosen: all). Done is
 * grouped by day.
 * @param {Row[]} rows
 * @param {string[]} agents chosen agent keys
 * @param {number} [now]
 * @returns {BoardColumn[]}
 */
export function board(rows, agents = [], now = Date.now()) {
  const kept = rows
    .filter((row) => agents.length === 0 || agents.includes(row.agentKey))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key));
  return /** @type {Column[]} */ (Object.keys(COLUMNS)).map((id) => {
    const mine = kept.filter((row) => row.column === id);
    /** @type {BoardColumn} */
    const column = {
      id,
      label: COLUMNS[id],
      rows: mine,
      count: mine.length,
      attention: id === "waiting" && mine.length > 0,
    };
    if (id === "done") {
      /** @type {Group[]} */
      const groups = [];
      for (const row of mine) {
        const label = bucketOf(row.at, now);
        const group = groups.find((g) => g.label === label);
        if (group) group.rows.push(row);
        else groups.push({ label, rows: [row] });
      }
      column.groups = groups;
    }
    return column;
  });
}

/** The agent chips over the board: every card with a row, in the cards' order. */
export function agentChips(/** @type {Row[]} */ rows, /** @type {Card[]} */ cards) {
  const counts = new Map();
  for (const row of rows) counts.set(row.agentKey, (counts.get(row.agentKey) ?? 0) + 1);
  return cards
    .filter((card) => counts.has(card.key))
    .map((card) => ({ id: card.key, label: card.name, count: counts.get(card.key), card }));
}
