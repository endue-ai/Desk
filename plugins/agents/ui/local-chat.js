// A chat with one local agent, without a DOM: send asks the agent (agents.ask, resuming the session
// on screen with its sessionId), the run's agents.run steps build the reply as it streams, Stop ends
// the run (agents.stop), and opening a session reads its history (agents.transcript). A message that
// lets the agent change files waits for the person's yes first (ADR 0099); a read-only one does not.

import { nativeSessionTurns, sessionTool } from "@endue-ai/ui/elements";

/**
 * @typedef {import("./local-api.js").LocalApi} LocalApi
 * @typedef {import("./local-api.js").LocalAgentRun} LocalAgentRun
 * @typedef {import("./local-api.js").LocalAgentRunData} LocalAgentRunData
 * @typedef {import("./local-api.js").LocalAgentAccess} LocalAgentAccess
 * @typedef {{ name: string, detail: string }} ToolLine
 * @typedef {object} ChatMessage
 * @property {string} id
 * @property {"user" | "assistant" | "tool"} role
 * @property {string} text
 * @property {Omit<import('@endue-ai/ui/elements').SessionTurn,'id'>[]} [parts]
 * @property {ToolLine[]} tools        what the agent used while answering
 * @property {LocalAgentRun} [joined]  a run already under way when its history was opened
 * @property {"streaming" | "done" | "failed" | "stopped"} [state]  an answer's, while and after it runs
 * @property {string} [error]
 * @property {string} [at]
 * @property {boolean} [cut]           the history cut this turn's text
 * @typedef {object} ChatState
 * @property {string} agent
 * @property {"done"|"failed"|"stopped"} [outcome]
 * @property {number} selection
 * @property {string} [sessionId]      the session the next message continues; none: a new one
 * @property {string} [title]
 * @property {ChatMessage[]} messages
 * @property {"idle" | "loading" | "sending" | "running" | "stopping"} phase
 * @property {string} [runId]
 * @property {string} [error]
 * @property {import('@endue-ai/ui/elements').SessionView['older']} [older]
 * @property {boolean} truncated       earlier turns of the session were left out
 * @property {LocalAgentAccess} access
 * @property {string} folder           where a new session works
 * @property {string} model            empty: the program's default
 */

/** The longest answer a run keeps, as the core cuts it. */
const TEXT_MAX = 8000;
const ENDS = new Set(["done", "failed", "stopped"]);

/**
 * @param {object} options
 * @param {LocalApi} options.api
 * @param {string} options.agent
 * @param {(question: { prompt: string, folder: string, agent: string }) => Promise<boolean>} options.approve
 *   the person's yes for a message that may change files
 * @param {(state: ChatState) => void} [options.changed]
 * @param {(run: LocalAgentRun) => void} [options.ended]  a run of this chat ended: its session changed
 */
export function createLocalChat({ api, agent, approve, changed = () => {}, ended = () => {} }) {
  /** @type {ChatState} */
  const state = {
    agent,
    selection: 0,
    messages: [],
    phase: "idle",
    truncated: false,
    access: "read-only",
    folder: "~",
    model: "",
  };
  let ids = 0;
  let generation = 0;
  let limit = 200;
  let historyCount = 0;
  const accessBySession = new Map();
  function switchAccess(id) {
    accessBySession.set(state.sessionId ?? "", state.access);
    state.access = accessBySession.get(id) ?? "read-only";
  }
  const historyMessages = (messages) =>
    nativeSessionTurns(messages).map((m) => ({
      ...m,
      text: m.role === "tool" ? (m.name ?? "tool") : m.text,
      tools: m.role === "tool" && m.text ? [{ name: m.name ?? "tool", detail: m.text }] : [],
      ...(m.role === "assistant" ? { state: "done" } : {}),
    }));
  /** Steps heard while attaching to a run or waiting for agents.ask to return its id. */
  /** @type {LocalAgentRunData[] | undefined} */
  let early;

  const emit = () => changed({ ...state, messages: state.messages.map((m) => ({ ...m })) });
  const nextId = () => `m${++ids}`;
  const answer = () => {
    const last = state.messages.at(-1);
    return last?.role === "assistant" && last.state === "streaming" ? last : undefined;
  };

  /** Fold one step of the chat's run into the reply. */
  const step = (/** @type {LocalAgentRunData} */ data) => {
    const reply = answer();
    if (data.sessionId) state.sessionId = data.sessionId;
    if (data.run?.sessionId) state.sessionId = data.run.sessionId;
    if (data.kind === "text" && data.text && reply) {
      reply.parts ??= [];
      reply.parts.push({ role: "assistant", text: data.text });
      const text = reply.text ? `${reply.text}\n\n${data.text}` : data.text;
      reply.text = text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text;
    }
    if (data.kind === "tool" && reply) {
      reply.tools.push({ name: data.tool ?? "tool", detail: data.detail ?? "" });
      reply.parts ??= [];
      reply.parts.push(sessionTool(data.tool ?? "tool", data.detail ?? ""));
    }
    if (data.kind === "started") state.phase = state.phase === "stopping" ? "stopping" : "running";
    if (ENDS.has(data.kind)) finish(data.kind, data.run);
  };

  const finish = (/** @type {string} */ kind, /** @type {LocalAgentRun | undefined} */ run) => {
    const reply = answer();
    if (reply) {
      if (run?.text && (!reply.text || run.text.startsWith(reply.text + "\n\n"))) {
        const remainder = reply.text ? run.text.slice(reply.text.length + 2) : run.text;
        if (reply.parts?.length) reply.parts.push({ role: "assistant", text: remainder });
        reply.text = run.text;
      }
      reply.state = /** @type {"done" | "failed" | "stopped"} */ (kind);
      if (kind === "failed") reply.error = run?.error ?? "The agent could not answer.";
    }
    if (run?.sessionId) state.sessionId = run.sessionId;
    state.outcome = kind;
    state.phase = "idle";
    delete state.runId;
    if (run) ended(run);
  };

  const off = api.onEvent((event) => {
    if (event.kind !== "run" || event.data.agent !== agent) return;
    if (early) early.push(event.data);
    else if (state.runId && event.data.runId === state.runId) {
      step(event.data);
      emit();
    }
  });

  return {
    get state() {
      return state;
    },
    /** Read a session's history; the next message continues it. */
    async open(
      /** @type {string} */ sessionId,
      /** @type {LocalAgentRun | undefined} */ running = undefined,
    ) {
      const mine = ++generation;
      state.selection = mine;
      const join =
        running?.state === "running" && running.agent === agent && running.sessionId === sessionId
          ? running
          : undefined;
      early = join ? [] : undefined;
      limit = 200;
      historyCount = 0;
      state.older = undefined;
      delete state.title;
      delete state.outcome;
      switchAccess(sessionId);
      Object.assign(state, { sessionId, messages: [], phase: "loading", truncated: false });
      delete state.error;
      delete state.runId;
      emit();
      try {
        const { session, messages, truncated } = await api.transcript(agent, sessionId);
        if (mine !== generation) return;
        state.title = session.title;
        state.truncated = truncated;
        state.messages = historyMessages(messages);
        historyCount = state.messages.length;
        state.older = truncated ? "more" : undefined;
      } catch (error) {
        if (mine !== generation) return;
        state.error = `The history could not be read: ${error instanceof Error ? error.message : error}`;
      }
      state.phase = "idle";
      const heard = early ?? [];
      early = undefined;
      if (join) {
        state.messages.push({
          id: nextId(),
          role: "assistant",
          joined: join,
          text: join.text,
          tools: [],
          state: "streaming",
          parts: join.text ? [{ role: "assistant", text: join.text }] : [],
        });
        state.runId = join.runId;
        state.phase = "running";
        for (const data of heard) if (data.runId === state.runId) step(data);
      }
      emit();
    },
    async older() {
      if (!state.sessionId || state.older !== "more") return;
      const mine = generation,
        id = state.sessionId,
        next = Math.min(1000, limit + 200);
      state.older = "loading";
      emit();
      try {
        const result = await api.transcript(agent, id, next);
        if (mine !== generation) return;
        const page = historyMessages(result.messages);
        const anchor = page.findIndex((m) => m.id === state.messages[0]?.id);
        const added = anchor < 0 ? page.length - historyCount : anchor;
        // Paging reads the beginning of the visible conversation. Keep turns already on screen,
        // including replies delivered during this read and not yet written to the session file.
        if (anchor >= 0) {
          state.messages.unshift(...page.slice(0, anchor));
          historyCount += anchor;
        } else {
          state.messages = [...page, ...state.messages.slice(historyCount)];
          historyCount = page.length;
        }
        limit = next;
        state.truncated = result.truncated;
        state.older = result.truncated ? (limit >= 1000 || added <= 0 ? "end" : "more") : undefined;
      } catch (err) {
        if (mine !== generation) return;
        state.error = String(err);
        state.older = "more";
      }
      emit();
    },
    /** Let go of the session: the next message starts a new one in the folder. */
    fresh() {
      state.selection = ++generation;
      early = undefined;
      limit = 200;
      historyCount = 0;
      state.older = undefined;
      switchAccess("");
      Object.assign(state, { messages: [], phase: "idle", truncated: false });
      for (const key of /** @type {const} */ (["sessionId", "title", "runId", "error", "outcome"]))
        delete state[key];
      emit();
    },
    /** @param {LocalAgentAccess} access */
    setAccess(access) {
      state.access = access;
      emit();
    },
    setFolder(/** @type {string} */ folder) {
      state.folder = folder.trim() || "~";
    },
    setModel(/** @type {string} */ model) {
      state.model = model.trim();
    },
    /** Send `text`: true once the agent was asked. */
    async send(/** @type {string} */ text) {
      const prompt = text.trim();
      if (!prompt || state.phase !== "idle") return false;
      const folder = state.sessionId ? "" : state.folder;
      const mine = generation,
        access = state.access;
      state.phase = "sending";
      emit();
      if (access === "agent") {
        let allowed;
        try {
          allowed = await approve({ prompt, folder, agent });
        } catch (error) {
          if (mine !== generation) return false;
          state.error = error instanceof Error ? error.message : String(error);
          state.phase = "idle";
          emit();
          return false;
        }
        if (mine !== generation) return false;
        if (!allowed) {
          state.phase = "idle";
          state.error = "Not sent: changes were not allowed.";
          emit();
          return false;
        }
      }
      if (mine !== generation) return false;
      delete state.error;
      state.messages.push({ id: nextId(), role: "user", text: prompt, tools: [] });
      state.messages.push({
        id: nextId(),
        role: "assistant",
        text: "",
        tools: [],
        state: "streaming",
      });
      // A new session is called what it was first asked, as the programs title their own.
      if (!state.sessionId && !state.title) state.title = prompt.slice(0, 80);
      state.phase = "sending";
      emit();
      early = [];
      try {
        const run = await api.ask({
          agent,
          prompt,
          access,
          ...(state.sessionId ? { sessionId: state.sessionId } : {}),
          ...(folder && folder !== "~" ? { cwd: folder } : {}),
          ...(state.model ? { model: state.model } : {}),
        });
        if (mine !== generation) return true;
        const heard = early ?? [];
        early = undefined;
        state.runId = run.runId;
        if (run.sessionId) state.sessionId = run.sessionId;
        state.phase = run.state === "running" ? "running" : state.phase;
        for (const data of heard) if (data.runId === run.runId && state.runId) step(data);
        if (run.state !== "running" && state.runId) finish(run.state, run);
      } catch (error) {
        if (mine !== generation) return false;
        early = undefined;
        const reply = answer();
        if (reply) {
          reply.state = "failed";
          reply.error = error instanceof Error ? error.message : String(error);
        }
        state.phase = "idle";
        emit();
        return false;
      }
      emit();
      return true;
    },
    /** End the run going on; its stopped step closes the reply. */
    async stop() {
      const runId = state.runId;
      if (!runId || state.phase === "stopping") return;
      state.phase = "stopping";
      emit();
      try {
        const run = await api.stop(runId);
        if (state.runId === runId && run.state !== "running") finish(run.state, run);
      } catch (error) {
        // not_found: it ended on its own first; its end step closes the reply.
        if (state.runId === runId && state.phase === "stopping") state.phase = "running";
        if (state.runId === runId && /** @type {{ kind?: string }} */ (error).kind !== "missing")
          state.error = `Could not stop: ${error instanceof Error ? error.message : error}`;
      }
      emit();
    },
    dispose: off,
  };
}

/** @typedef {ReturnType<typeof createLocalChat>} LocalChat */
