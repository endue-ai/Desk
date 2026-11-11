// The plugin's commands (endue.local-agents.*, from the palette, keys, Eris and agents) and the
// actions the view's keys and buttons run, all on the controller. No DOM.

import { VIEWS } from "./agents.js";
import { agentById } from "./catalog.js";
import { registerSchemas } from "./schemas.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginCommands} PluginCommands
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {import("./agents.js").App} App
 * @typedef {import("./talk.js").Talk} Talk
 * @typedef {import("./tasks.js").Tasks} Tasks
 * @typedef {Record<string, unknown>} Args
 */

/**
 * @param {{ commands: PluginCommands, bridge: Pick<PluginBridge, "call"> }} ctx
 * @param {App} app
 * @param {Talk} talk
 * @param {Tasks} tasks
 * @returns {Record<string, (...args: any[]) => unknown>} The actions the view runs.
 */
export function wireCommands({ commands, bridge }, app, talk, tasks) {
  /** Ask for text when a command was run without it; a cancel ends the command quietly. */
  const textOr = async (/** @type {unknown} */ given, /** @type {string} */ title) => {
    if (given !== undefined) return given;
    const text = await app.pick(title, [], true, "what to ask");
    if (text === undefined || text === "") throw app.cancelled("Nothing was asked.");
    return text;
  };

  /** Ask which agent, among the ones found. */
  const pickAgent = async (/** @type {string} */ title) => {
    const found = app.found();
    if (found.length === 0) throw new Error("No agent program is installed: see the Agents view.");
    const picked = await app.pick(
      title,
      found.map((s) => ({
        id: s.id,
        label: s.id === app.ui.chatAgent ? `${s.name} (in the chat)` : s.name,
        detail: `${s.vendor} · ${s.command} ${s.version}`,
      })),
    );
    if (!picked) throw app.cancelled("No agent was picked.");
    return picked;
  };

  const nameOf = (/** @type {unknown} */ agent) =>
    agentById(agent ?? app.ui.chatAgent)?.name ?? "the agent";

  /**
   * Ask for a conversation's model: the program's default (""), the one in use, or a name typed.
   * Undefined when the person cancels.
   */
  const pickModel = async (/** @type {unknown} */ agent) => {
    const name = nameOf(agent);
    const id = agentById(agent ?? app.ui.chatAgent)?.id;
    const current = id ? app.chats.peek(id).model : "";
    return app.pick(
      `Local agents: ${name}'s model`,
      [
        { id: "", label: "Its default model", detail: `The model ${name} picks itself` },
        ...(current ? [{ id: current, label: current, detail: "In use" }] : []),
      ],
      true,
      "Type a model name, or pick its default",
    );
  };

  /**
   * Answer a command. A failure goes to the status line and ends the command with the same words,
   * which the desk shows in its own notice.
   * @param {string} name
   * @param {(args: Args) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        return await handler(/** @type {Args} */ (args ?? {}));
      } catch (error) {
        if (/** @type {{ code?: string }} */ (error)?.code !== "cancelled")
          app.say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  const p = "endue.local-agents";
  answer(`${p}.open`, ({ view }) =>
    app.show(VIEWS.includes(/** @type {any} */ (view)) ? /** @type {any} */ (view) : app.ui.view),
  );
  answer(`${p}.detect`, () => app.detect());
  answer(`${p}.list`, async () => {
    await app.ready;
    return app.statuses();
  });
  answer(`${p}.ask`, async ({ prompt, agent, model, folder }) =>
    talk.ask(await textOr(prompt, `Local agents: ask ${nameOf(agent)}`), agent, model, folder),
  );
  answer(`${p}.work`, async ({ prompt, agent, model, folder }) =>
    talk.work(
      await textOr(prompt, `Local agents: a task for ${nameOf(agent)}`),
      agent,
      model,
      folder,
    ),
  );
  answer(`${p}.chat`, async ({ agent, prompt }) => {
    if (agent !== undefined) await talk.useAgent(agent);
    else app.show("chat");
    return prompt === undefined ? app.ui.chatAgent : talk.send(prompt, agent);
  });
  answer(`${p}.new-chat`, ({ agent }) => talk.newChat(agent));
  answer(`${p}.use`, async ({ agent }) =>
    talk.useAgent(agent ?? (await pickAgent("Local agents: talk to which agent?"))),
  );
  answer(`${p}.model`, async ({ model, agent }) => {
    const chosen = model ?? (await pickModel(agent));
    if (chosen === undefined) throw app.cancelled("No model was given.");
    return talk.setModel(chosen, agent);
  });
  answer(`${p}.compare`, async ({ prompt, agents }) =>
    talk.compare(await textOr(prompt, "Local agents: ask every agent"), agents),
  );
  answer(`${p}.board`, () => {
    app.show("board");
    return tasks.cards();
  });
  // An agent may put a task on the board; running it stays the person's (ADR 0099).
  answer(`${p}.add-card`, async ({ prompt, title, agent }) =>
    tasks.addCard({
      prompt: await textOr(prompt, "Local agents: a new card's prompt"),
      title,
      agent,
    }),
  );
  answer(`${p}.run-card`, ({ card }) => tasks.runCard(card));
  answer(`${p}.move-card`, ({ card, column }) => tasks.moveCard(card, column));
  answer(`${p}.remove-card`, ({ card }) => tasks.removeCard(card));
  answer(`${p}.clear-done`, () => tasks.clearDone());
  answer(`${p}.activity`, () => {
    app.show("activity");
    return app.runs.list().map(({ tools: _tools, ...run }) => run);
  });
  answer(`${p}.stop`, ({ run }) => {
    if (run === undefined) return app.runs.stopAll();
    if (!app.runs.find(run)) throw new Error(`No run ${String(run)}.`);
    return app.runs.stop(/** @type {string} */ (run)) ? 1 : 0;
  });
  registerSchemas(bridge);

  /** What the view's keys and buttons run: a failure is said, never thrown at the DOM. */
  const guard =
    (/** @type {(...args: any[]) => unknown} */ fn) =>
    async (/** @type {unknown[]} */ ...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        if (/** @type {{ code?: string }} */ (error)?.code === "cancelled") return undefined;
        app.say(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    };

  /** @type {Record<string, (...args: any[]) => unknown>} */
  const actions = {
    // A view is shown by its name as an argument: a view's name is never an action of its own,
    // so Compare (the view) and askCompared (its question) cannot be taken for each other.
    show: (/** @type {import("./agents.js").ViewName} */ name) => app.show(name),
    detect: () => app.detect(),
    send: (/** @type {string} */ text) => talk.send(text),
    newChat: () => talk.newChat(undefined),
    useAgent: (/** @type {string} */ id) => talk.useAgent(id),
    pickAgent: async () => talk.useAgent(await pickAgent("Local agents: talk to which agent?")),
    stopChat: () => talk.stopChat(undefined),
    pickModel: async () => {
      const chosen = await pickModel(undefined);
      if (chosen !== undefined) await talk.setModel(chosen, undefined);
    },
    askCompared: (/** @type {string} */ text) => talk.compare(text),
    toggleCompared: (/** @type {string} */ id) => talk.toggleCompared(id),
    stopCompare: () => app.runs.stopAll("compare"),
    addCard: (/** @type {Args} */ spec) => tasks.addCard(spec),
    newCard: async () =>
      tasks.addCard({ prompt: await textOr(undefined, "Local agents: a new card's prompt") }),
    runCard: (/** @type {string} */ id) => tasks.runCard(id),
    moveCard: (/** @type {string} */ id, /** @type {string} */ column, /** @type {number} */ at) =>
      tasks.moveCard(id, column, at),
    shiftCard: (/** @type {string} */ id, /** @type {-1 | 1} */ by) => tasks.shiftCard(id, by),
    stopCard: (/** @type {string} */ id) => tasks.stopCard(id),
    removeCard: (/** @type {string} */ id) => tasks.removeCard(id),
    selectCard: (/** @type {string} */ id) => tasks.select(id),
    clearDone: () => tasks.clearDone(),
    cardAgent: async (/** @type {string} */ id) =>
      tasks.editCard(id, { agent: await pickAgent("Local agents: which agent takes the card?") }),
    selectRun: (/** @type {string} */ id) => {
      app.ui.run = app.ui.run === id ? "" : id;
      app.paint();
    },
    stopRun: (/** @type {string} */ id) => app.runs.stop(id),
    stopAll: () => app.runs.stopAll(),
  };
  return Object.fromEntries(Object.entries(actions).map(([name, fn]) => [name, guard(fn)]));
}
