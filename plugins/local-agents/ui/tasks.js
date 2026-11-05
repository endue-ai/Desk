// The board's work: cards put in Running wait for a free place (endue.local-agents.parallel at
// once), run, and land in Done or Failed. A card taken out of Running while it runs is stopped and
// stays where it was put.

import { COLUMNS, titleOf } from "./board.js";
import { agentById } from "./catalog.js";
import { promptOf } from "./talk.js";

/**
 * @typedef {import("./agents.js").App} App
 * @typedef {import("./board.js").Card} Card
 * @typedef {import("./board.js").Column} Column
 */

/** @param {App} app */
export function createTasks(app) {
  const { board, runs, ui } = app;

  /** A card by id, or the selected one. */
  const cardOf = (/** @type {unknown} */ id) => {
    const card = board.find(id === undefined || id === "" ? ui.card : id);
    if (!card)
      throw new Error(id === undefined ? "Select a card first." : `No card ${String(id)}.`);
    return card;
  };

  const columnOf = (/** @type {unknown} */ column) => {
    if (!COLUMNS.includes(/** @type {Column} */ (column)))
      throw new Error(`column is one of ${COLUMNS.join(", ")}.`);
    return /** @type {Column} */ (column);
  };

  /** Start waiting cards while there is room. */
  const pump = () => {
    const limit = app.settings().parallel;
    const busy = board.column("running").filter((c) => c.run && !c.waiting).length;
    const waiting = board.column("running").filter((c) => c.waiting);
    for (const card of waiting.slice(0, Math.max(0, limit - busy))) void begin(card);
  };

  /** Run one card now. @param {Card} card */
  const begin = async (card) => {
    board.update(card.id, { waiting: false }, false);
    /** @type {import("./catalog.js").Agent} */
    let agent;
    try {
      agent = await app.usable(card.agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      board.move(card.id, "failed");
      board.update(card.id, { error: message });
      app.paint();
      pump();
      return;
    }
    const { run, done } = runs.start(app.question(agent, card.prompt), "board");
    board.update(card.id, { run: run.id }, false);
    app.paint();
    const result = await done;
    const now = board.find(card.id);
    if (now && now.run === run.id) {
      const patch = {
        run: undefined,
        answer: result.answer,
        error: result.error || undefined,
        ms: run.ended - run.started,
      };
      if (now.column === "running")
        board.move(card.id, result.ending === "done" ? "done" : "failed");
      board.update(card.id, patch);
    }
    app.paint();
    pump();
  };

  /**
   * A new card; with `run`, it goes to Running at once.
   * @param {{ title?: unknown, prompt?: unknown, agent?: unknown, run?: unknown }} spec
   */
  const addCard = async (spec) => {
    const prompt = promptOf(spec.prompt);
    const agent = spec.agent === undefined || spec.agent === "" ? ui.chatAgent : spec.agent;
    if (!agentById(agent)) throw new Error("agent is an agent id, like claude or codex.");
    const card = board.add({
      prompt,
      agent: /** @type {string} */ (agent),
      ...(typeof spec.title === "string" ? { title: titleOf(spec.title, prompt) } : {}),
    });
    ui.card = card.id;
    if (spec.run === true) await runCard(card.id);
    else app.paint();
    return board.find(card.id);
  };

  /** Put a card in Running: it starts when there is room. Asks first when it must. */
  const runCard = async (/** @type {unknown} */ id) => {
    const card = cardOf(id);
    if (card.column === "running") return card;
    await app.usable(card.agent);
    board.move(card.id, "running");
    board.update(card.id, { waiting: true, error: undefined, answer: undefined }, false);
    ui.card = card.id;
    app.paint();
    pump();
    return board.find(card.id);
  };

  /**
   * Put a card in a column (before the card at `index` there). Into Running runs it; out of
   * Running stops it.
   * @param {unknown} id
   * @param {unknown} column
   * @param {number} [index]
   */
  const moveCard = async (id, column, index) => {
    const card = cardOf(id);
    const to = columnOf(column);
    if (to === "running") return runCard(card.id);
    if (card.column === "running" && card.run) runs.stop(card.run);
    board.move(card.id, to, index);
    board.update(card.id, { waiting: false }, false);
    ui.card = card.id;
    app.paint();
    pump();
    return board.find(card.id);
  };

  /** The column to the left (-1) or right (+1) of the card's. */
  const shiftCard = (/** @type {unknown} */ id, /** @type {-1 | 1} */ by) => {
    const card = cardOf(id);
    const at = COLUMNS.indexOf(card.column) + by;
    const to = COLUMNS[Math.max(0, Math.min(COLUMNS.length - 1, at))];
    return to === card.column ? Promise.resolve(card) : moveCard(card.id, to);
  };

  /** Stop a running card's run; it goes to Failed as stopped. */
  const stopCard = (/** @type {unknown} */ id) => {
    const card = cardOf(id);
    if (card.waiting) return moveCard(card.id, "todo");
    if (card.run) runs.stop(card.run);
    return Promise.resolve(card);
  };

  const removeCard = (/** @type {unknown} */ id) => {
    const card = cardOf(id);
    if (card.run) runs.stop(card.run);
    board.remove(card.id);
    if (ui.card === card.id) ui.card = "";
    app.paint();
    return card;
  };

  /** Change a card's title, prompt or agent. */
  const editCard = (/** @type {unknown} */ id, /** @type {Record<string, unknown>} */ patch) => {
    const card = cardOf(id);
    const prompt = patch.prompt === undefined ? card.prompt : promptOf(patch.prompt);
    if (patch.agent !== undefined && !agentById(patch.agent))
      throw new Error("agent is an agent id, like claude or codex.");
    const title = typeof patch.title === "string" ? patch.title : card.title;
    board.update(card.id, {
      prompt,
      title: titleOf(title, prompt),
      ...(patch.agent !== undefined ? { agent: /** @type {string} */ (patch.agent) } : {}),
    });
    app.paint();
    return board.find(card.id);
  };

  const select = (/** @type {string} */ id) => {
    if (board.find(id)) ui.card = id;
    app.paint();
  };

  const clearDone = () => {
    const n = board.clearDone();
    if (!board.find(ui.card)) ui.card = "";
    app.paint();
    return n;
  };

  return {
    addCard,
    runCard,
    moveCard,
    shiftCard,
    stopCard,
    removeCard,
    editCard,
    select,
    clearDone,
    cards: () => board.all(),
  };
}

/** @typedef {ReturnType<typeof createTasks>} Tasks */
