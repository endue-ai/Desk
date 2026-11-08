// A chat with one local agent, without a DOM: send asks the agent (agents.ask, resuming the session
// on screen with its sessionId), the run's agents.run steps build the reply as it streams, Stop ends
// the run (agents.stop), and opening a session reads its history (agents.transcript). A message that
// lets the agent change files waits for the person's yes first (ADR 0099); a read-only one does not.

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
 * @property {ToolLine[]} tools        what the agent used while answering
 * @property {"streaming" | "done" | "failed" | "stopped"} [state]  an answer's, while and after it runs
 * @property {string} [error]
 * @property {string} [at]
 * @property {boolean} [cut]           the history cut this turn's text
 * @typedef {object} ChatState
 * @property {string} agent
 * @property {string} [sessionId]      the session the next message continues; none: a new one
 * @property {string} [title]
 * @property {ChatMessage[]} messages
 * @property {"idle" | "loading" | "sending" | "running" | "stopping"} phase
 * @property {string} [runId]
 * @property {string} [error]
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
    messages: [],
    phase: "idle",
    truncated: false,
    access: "read-only",
    folder: "~",
    model: "",
  };
  let ids = 0;
  let generation = 0;
  /** Steps heard while agents.ask had not answered yet: the run's id is not known. */
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
      const text = reply.text ? `${reply.text}\n\n${data.text}` : data.text;
      reply.text = text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text;
    }
    if (data.kind === "tool" && reply)
      reply.tools.push({ name: data.tool ?? "tool", detail: data.detail ?? "" });
    if (data.kind === "started") state.phase = state.phase === "stopping" ? "stopping" : "running";
    if (ENDS.has(data.kind)) finish(data.kind, data.run);
  };

  const finish = (/** @type {string} */ kind, /** @type {LocalAgentRun | undefined} */ run) => {
    const reply = answer();
    if (reply) {
      if (!reply.text && run?.text) reply.text = run.text;
      reply.state = /** @type {"done" | "failed" | "stopped"} */ (kind);
      if (kind === "failed") reply.error = run?.error ?? "The agent could not answer.";
    }
    if (run?.sessionId) state.sessionId = run.sessionId;
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
      Object.assign(state, { sessionId, messages: [], phase: "loading", truncated: false });
      delete state.error;
      delete state.runId;
      emit();
      try {
        const { session, messages, truncated } = await api.transcript(agent, sessionId);
        if (mine !== generation) return;
        state.title = session.title;
        state.truncated = truncated;
        state.messages = messages.map((m) => ({
          id: nextId(),
          role: m.role,
          text: m.role === "tool" ? (m.name ?? "tool") : m.text,
          tools: m.role === "tool" && m.text ? [{ name: m.name ?? "tool", detail: m.text }] : [],
          ...(m.role === "assistant" ? { state: /** @type {const} */ ("done") } : {}),
          ...(m.at ? { at: m.at } : {}),
          ...(m.cut ? { cut: true } : {}),
        }));
        state.phase = "idle";
        // A run of this session going on now (started anywhere) streams here, and Stop ends it.
        if (running?.state === "running") {
          state.messages.push({ id: nextId(), role: "assistant", text: running.text, tools: [] });
          /** @type {ChatMessage} */ (state.messages.at(-1)).state = "streaming";
          state.runId = running.runId;
          state.phase = "running";
        }
      } catch (error) {
        if (mine !== generation) return;
        state.phase = "idle";
        state.error = `The history could not be read: ${error instanceof Error ? error.message : error}`;
      }
      emit();
    },
    /** Let go of the session: the next message starts a new one in the folder. */
    fresh() {
      generation++;
      Object.assign(state, { messages: [], phase: "idle", truncated: false });
      for (const key of /** @type {const} */ (["sessionId", "title", "runId", "error"]))
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
      if (state.access === "agent" && !(await approve({ prompt, folder, agent }))) {
        state.error = "Not sent: changes were not allowed.";
        emit();
        return false;
      }
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
          access: state.access,
          ...(state.sessionId ? { sessionId: state.sessionId } : {}),
          ...(folder && folder !== "~" ? { cwd: folder } : {}),
          ...(state.model ? { model: state.model } : {}),
        });
        const heard = early;
        early = undefined;
        state.runId = run.runId;
        if (run.sessionId) state.sessionId = run.sessionId;
        state.phase = run.state === "running" ? "running" : state.phase;
        if (run.state !== "running") finish(run.state, run);
        for (const data of heard) if (data.runId === run.runId && state.runId) step(data);
      } catch (error) {
        early = undefined;
        const reply = answer();
        if (reply) {
          reply.state = "failed";
          reply.error = error instanceof Error ? error.message : String(error);
        }
        state.phase = "idle";
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
        if (/** @type {{ kind?: string }} */ (error).kind !== "missing")
          state.error = `Could not stop: ${error instanceof Error ? error.message : error}`;
      }
      emit();
    },
    dispose: off,
  };
}

/** @typedef {ReturnType<typeof createLocalChat>} LocalChat */
