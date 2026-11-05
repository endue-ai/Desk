// What the views draw, made from the controller's state in one pass: the agents found, the chat's
// messages (an answer that is still streaming reads from its run), the comparison's columns, the
// board's columns and the activity. Plain data, so a recording view in tests holds it as it is.

import { COLUMN_TITLES, COLUMNS } from "./board.js";
import { agentById } from "./catalog.js";

/**
 * @typedef {import("./agents.js").App} App
 * @typedef {import("./runs.js").Run} Run
 * @typedef {{ name: string, detail: string }} Tool
 * @typedef {{ id: string, role: "user" | "agent", text: string, status: string, error: string,
 *   tools: Tool[], meta: string }} MessageModel
 * @typedef {{ agent: string, name: string, status: string, text: string, error: string,
 *   tools: Tool[], meta: string }} PaneModel
 * @typedef {{ id: string, title: string, prompt: string, agent: string, agentName: string,
 *   state: string, answer: string, error: string, meta: string }} CardModel
 * @typedef {{ id: string, agent: string, name: string, origin: string, prompt: string,
 *   status: string, answer: string, error: string, line: string, tools: Tool[], meta: string }} RunModel
 * @typedef {{
 *   view: import("./agents.js").ViewName,
 *   access: "read-only" | "agent", folder: string, busy: number,
 *   agents: import("./detect.js").Status[], found: number,
 *   chat: { agent: string, name: string, ready: boolean, model: string, session: string,
 *     resumes: boolean, running: boolean, messages: MessageModel[] },
 *   compare: { prompt: string, picked: string[], panes: PaneModel[], running: boolean },
 *   board: { columns: { id: string, title: string, cards: CardModel[] }[], selected: string,
 *     open: CardModel | undefined, parallel: number },
 *   activity: { runs: RunModel[], open: RunModel | undefined },
 * }} ViewModel
 */

/** Seconds, or minutes and seconds, from milliseconds. */
export function duration(/** @type {number} */ ms) {
  if (!(ms > 0)) return "";
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? Math.max(0.1, s).toFixed(1) : Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** What a run cost and took, in a few words: "3.2 s · 1,204 tokens · $0.012". */
export function metaOf(
  /** @type {number} */ ms,
  /** @type {import("./parse.js").Reply["usage"]} */ usage = {},
) {
  const tokens = (usage.input ?? 0) + (usage.output ?? 0);
  return [
    duration(ms),
    tokens > 0 ? `${tokens.toLocaleString("en-US")} tokens` : "",
    usage.cost !== undefined && usage.cost > 0 ? `$${usage.cost.toFixed(3)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A run's time so far, or its whole time once it ended. */
const elapsed = (/** @type {App} */ app, /** @type {Run} */ run) =>
  (run.ended || app.now()) - run.started;

/** @param {App} app @param {Run} run @returns {RunModel} */
export function runModel(app, run) {
  return {
    id: run.id,
    agent: run.agent,
    name: run.name,
    origin: run.origin,
    prompt: run.prompt,
    status: run.ending,
    answer: run.answer,
    error: run.error,
    line: run.line,
    tools: run.tools.slice(-10),
    meta: metaOf(elapsed(app, run), run.usage),
  };
}

/** @param {App} app @returns {ViewModel["chat"]} */
function chatModel(app) {
  const id = app.ui.chatAgent;
  const agent = agentById(id);
  const conversation = app.chats.peek(id);
  const messages = conversation.messages.map((m) => {
    const run = m.run ? app.runs.find(m.run) : undefined;
    const live = m.status === "running" && run;
    return {
      id: m.id,
      role: m.role,
      text: live ? run.answer : m.text,
      status: m.status ?? "done",
      error: m.error ?? "",
      tools: (live ? run.tools : (m.tools ?? [])).slice(-10),
      meta:
        m.role === "agent"
          ? live
            ? metaOf(elapsed(app, run), run.usage)
            : metaOf(m.ms ?? 0, m.usage)
          : "",
    };
  });
  return {
    agent: id,
    name: agent?.name ?? "",
    ready: app.status(id)?.state === "ready",
    model: conversation.model,
    session: conversation.session,
    resumes: agent?.resumes ?? false,
    running: messages.some((m) => m.status === "running"),
    messages,
  };
}

/** @param {App} app @returns {ViewModel["compare"]} */
function compareModel(app) {
  const panes = app.ui.compareRuns.flatMap((id) => {
    const run = app.runs.find(id);
    if (!run) return [];
    const { name, status, answer, error, tools, meta, agent } = runModel(app, run);
    return [{ agent, name, status, text: answer, error, tools, meta }];
  });
  return {
    prompt: app.ui.comparePrompt,
    picked: [...app.ui.compare],
    panes,
    running: panes.some((p) => p.status === "running"),
  };
}

/** @param {App} app @param {import("./board.js").Card} card @returns {CardModel} */
function cardModel(app, card) {
  const run = card.run ? app.runs.find(card.run) : undefined;
  const state = card.waiting ? "waiting" : run ? "running" : card.column;
  return {
    id: card.id,
    title: card.title,
    prompt: card.prompt,
    agent: card.agent,
    agentName: agentById(card.agent)?.name ?? card.agent,
    state,
    answer: run ? run.answer : (card.answer ?? ""),
    error: card.error ?? "",
    meta: run ? metaOf(elapsed(app, run), run.usage) : duration(card.ms ?? 0),
  };
}

/**
 * @param {App} app
 * @returns {ViewModel}
 */
export function viewModel(app) {
  const settings = app.settings();
  const agents = app.statuses();
  const cards = COLUMNS.map((id) => ({
    id,
    title: COLUMN_TITLES[id],
    cards: app.board.column(id).map((card) => cardModel(app, card)),
  }));
  const selected = app.board.find(app.ui.card);
  const runs = app.runs.list().map((run) => runModel(app, run));
  return {
    view: app.ui.view,
    access: settings.access,
    folder: settings.folder,
    busy: app.runs.running().length,
    agents,
    found: agents.filter((a) => a.state === "ready").length,
    chat: chatModel(app),
    compare: compareModel(app),
    board: {
      columns: cards,
      selected: selected?.id ?? "",
      open: selected ? cardModel(app, selected) : undefined,
      parallel: settings.parallel,
    },
    activity: { runs, open: runs.find((r) => r.id === app.ui.run) },
  };
}
