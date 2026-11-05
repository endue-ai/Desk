// Talking to agents: a conversation with one (the chat), the same question to several side by side
// (compare) and one question with no conversation (ask, for commands). Each question is a run, so
// the Activity view lists it and it can be stopped.

import { AGENT_IDS, agentById, isValue } from "./catalog.js";

/**
 * @typedef {import("./agents.js").App} App
 * @typedef {import("./ask.js").Result} Result
 * @typedef {{ agent: string, name: string, ending: Result["ending"], answer: string, error: string,
 *   session?: string }} Answer
 */

const PROMPT_MAX = 100_000;

/** A prompt as given: text with something in it, not too long. */
export function promptOf(/** @type {unknown} */ value) {
  if (typeof value !== "string" || !value.trim())
    throw new Error("prompt is the question, as text.");
  if (value.length > PROMPT_MAX)
    throw new Error(`The prompt is ${value.length} characters; at most ${PROMPT_MAX}.`);
  return value;
}

/** @param {Result} result @param {import("./catalog.js").Agent} agent @returns {Answer} */
const answerOf = (result, agent) => ({
  agent: agent.id,
  name: agent.name,
  ending: result.ending,
  answer: result.answer,
  error: result.error,
  ...(result.reply.session ? { session: result.reply.session } : {}),
});

/** @param {App} app */
export function createTalk(app) {
  const { chats, runs, ui } = app;
  /** The chat run in flight for each agent. @type {Map<string, string>} */
  const chatting = new Map();

  /** The chat's agent: the one named, or the one on screen. */
  const chatAgentOf = (/** @type {unknown} */ agent) => {
    const id = agent === undefined || agent === "" ? ui.chatAgent : agent;
    if (id !== "" && !agentById(id))
      throw new Error(`No agent called ${String(id)}. The agents: ${AGENT_IDS.join(", ")}.`);
    if (!agentById(id)) throw new Error("No agent is installed yet: install one, then Look again.");
    return /** @type {string} */ (id);
  };

  /** Talk to another agent in the chat. */
  const useAgent = async (/** @type {unknown} */ agent) => {
    const id = chatAgentOf(agent);
    ui.chatAgent = id;
    await chats.open(id);
    app.keepPrefs();
    app.show("chat");
    return id;
  };

  /**
   * Send a message in the agent's conversation and resolve with its answer.
   * @param {unknown} text
   * @param {unknown} [agentId]
   * @returns {Promise<Answer>}
   */
  const send = async (text, agentId) => {
    const prompt = promptOf(text);
    const id = chatAgentOf(agentId);
    if (chatting.has(id))
      throw new Error(`${agentById(id)?.name} is still answering: wait, or stop it first.`);
    const agent = await app.usable(id);
    const conversation = await chats.open(id);
    const history = chats.history(id);
    chatting.set(id, "");
    try {
      await chats.add(id, { role: "user", text: prompt, status: "done" });
      const reply = await chats.add(id, { role: "agent", text: "", status: "running" });
      const { run, done } = runs.start(
        app.question(agent, prompt, {
          history,
          ...(conversation.session ? { session: conversation.session } : {}),
          ...(conversation.model ? { model: conversation.model } : {}),
        }),
        "chat",
      );
      chatting.set(id, run.id);
      chats.update(id, reply.id, { run: run.id });
      app.paint();
      const result = await done;
      if (result.reply.session) chats.setSession(id, result.reply.session);
      chats.update(
        id,
        reply.id,
        {
          text: result.answer,
          status: result.ending,
          ...(result.error ? { error: result.error } : {}),
          tools: result.reply.tools.slice(-10),
          ms: run.ended - run.started,
          usage: { ...result.reply.usage },
        },
        true,
      );
      app.paint();
      return answerOf(result, agent);
    } finally {
      chatting.delete(id);
    }
  };

  /** Start the agent's conversation over. */
  const newChat = async (/** @type {unknown} */ agent) => {
    const id = chatAgentOf(agent);
    stopChat(id);
    await chats.clear(id);
    ui.chatAgent = id;
    app.show("chat");
    return id;
  };

  /** Stop the chat's answer in progress; false when none is. */
  const stopChat = (/** @type {unknown} */ agent) => {
    const run = chatting.get(chatAgentOf(agent));
    return run ? runs.stop(run) : false;
  };

  /** The model the agent's conversation asks for; "" is the program's own default. */
  const setModel = async (/** @type {unknown} */ model, /** @type {unknown} */ agent) => {
    if (typeof model !== "string" || (model !== "" && !isValue(model)))
      throw new Error("model is a model name with no spaces, like opus or gpt-5, or empty.");
    const id = chatAgentOf(agent);
    const kept = await chats.setModel(id, model);
    app.paint();
    return kept;
  };

  /** Which agents compare asks; at least one. */
  const setCompared = (/** @type {unknown} */ agents) => {
    if (!Array.isArray(agents) || agents.length === 0 || !agents.every((a) => agentById(a)))
      throw new Error("agents are agent ids, like claude and codex.");
    ui.compare = [...new Set(/** @type {string[]} */ (agents))];
    app.keepPrefs();
    app.paint();
    return ui.compare;
  };

  /** Add or take one agent out of the ones compare asks. */
  const toggleCompared = (/** @type {string} */ agent) => {
    const on = ui.compare.includes(agent);
    if (on && ui.compare.length === 1) return ui.compare;
    return setCompared(on ? ui.compare.filter((a) => a !== agent) : [...ui.compare, agent]);
  };

  /**
   * The same question to several agents at once; resolves when every one has answered.
   * @param {unknown} text
   * @param {unknown} [agents]
   * @returns {Promise<Answer[]>}
   */
  const compare = async (text, agents) => {
    const prompt = promptOf(text);
    if (agents !== undefined) setCompared(agents);
    if (runs.running().some((r) => r.origin === "compare"))
      throw new Error("A comparison is still running: wait, or stop it first.");
    const ids = ui.compare.filter((a) => app.status(a)?.state === "ready");
    if (ids.length === 0) throw new Error("None of the agents to compare is found.");
    /** @type {import("./catalog.js").Agent[]} */
    const picked = [];
    for (const id of ids) picked.push(await app.usable(id));
    ui.comparePrompt = prompt;
    const started = picked.map((agent) => ({
      agent,
      ...runs.start(app.question(agent, prompt), "compare"),
    }));
    ui.compareRuns = started.map((s) => s.run.id);
    app.show("compare");
    const results = await Promise.all(started.map((s) => s.done));
    app.paint();
    return results.map((result, i) => answerOf(result, started[i]?.agent ?? picked[0]));
  };

  /**
   * One question with no conversation; the Activity view shows it.
   * @param {unknown} text
   * @param {unknown} [agentId]
   * @param {unknown} [model]
   * @returns {Promise<Answer>}
   */
  const ask = async (text, agentId, model) => {
    const prompt = promptOf(text);
    const agent = await app.usable(agentId === undefined ? chatAgentOf(undefined) : agentId);
    if (model !== undefined && !isValue(model)) throw new Error("model is a name with no spaces.");
    const { run, done } = runs.start(
      app.question(agent, prompt, typeof model === "string" ? { model } : {}),
      "command",
    );
    ui.run = run.id;
    const result = await done;
    app.paint();
    return answerOf(result, agent);
  };

  return {
    useAgent,
    send,
    newChat,
    stopChat,
    setModel,
    setCompared,
    toggleCompared,
    compare,
    ask,
    chatting: (/** @type {string} */ agent) => chatting.has(agent),
  };
}

/** @typedef {ReturnType<typeof createTalk>} Talk */
