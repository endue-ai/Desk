// The board: tasks as cards in four columns. A card is a prompt for one agent; it waits in To do,
// runs in Running (the controller starts it, a few at a time), and lands in Done with the answer or
// in Failed with what went wrong. Kept under `board`, cut to fit the desk's store.

import { AGENT_IDS } from "./catalog.js";
import { clip, fitList, load, save } from "./store.js";

/**
 * @typedef {"todo" | "running" | "done" | "failed"} Column
 * @typedef {{ id: string, title: string, prompt: string, agent: string, column: Column,
 *   created: number, updated: number, answer?: string, error?: string, run?: string,
 *   waiting?: boolean, ms?: number }} Card
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

/** @type {readonly Column[]} */
export const COLUMNS = Object.freeze(["todo", "running", "done", "failed"]);

export const COLUMN_TITLES = Object.freeze({
  todo: "To do",
  running: "Running",
  done: "Done",
  failed: "Failed",
});

export const BOARD_KEY = "board";
const CARDS_KEPT = 300;
const ANSWER_KEPT = 8_000;
const TITLE_MAX = 120;

/** A card's title: the one given, or the prompt's first line. */
export function titleOf(/** @type {string} */ title, /** @type {string} */ prompt) {
  const text = (title.trim() || prompt.trim().split("\n")[0] || "Untitled").replace(/\s+/g, " ");
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

/** The cards the store held that still make sense; a running one did not finish. */
export function readCards(/** @type {unknown} */ value) {
  const list = /** @type {{ cards?: unknown } | undefined} */ (value)?.cards;
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (c) =>
        c &&
        typeof c.id === "string" &&
        typeof c.prompt === "string" &&
        typeof c.title === "string" &&
        AGENT_IDS.includes(c.agent) &&
        COLUMNS.includes(c.column),
    )
    .map((c) => {
      const { run: _run, waiting: _waiting, ...card } = /** @type {Card} */ (c);
      return card.column === "running"
        ? {
            ...card,
            column: /** @type {Column} */ ("todo"),
            error: "Stopped when the desk closed.",
          }
        : card;
    });
}

/**
 * @param {Bridge} bridge
 * @param {{ now(): number, id(): string }} env
 */
export function createBoard(bridge, env) {
  /** @type {Card[]} */
  let cards = [];

  const persist = () => {
    const kept = cards.slice(-CARDS_KEPT).map((c) => {
      const { run: _run, waiting: _waiting, ...card } = c;
      return card.answer ? { ...card, answer: clip(card.answer, ANSWER_KEPT) } : card;
    });
    const wrap = (/** @type {unknown[]} */ list) => ({ cards: list });
    void save(bridge, BOARD_KEY, wrap(fitList(kept, wrap)));
  };

  const ready = load(bridge, BOARD_KEY).then((value) => {
    cards = [...readCards(value), ...cards];
  });

  const find = (/** @type {unknown} */ id) => cards.find((c) => c.id === id);

  /** The cards of one column, in order. */
  const column = (/** @type {Column} */ name) => cards.filter((c) => c.column === name);

  /**
   * A new card in To do.
   * @param {{ title?: string, prompt: string, agent: string }} spec
   */
  const add = (spec) => {
    const at = env.now();
    /** @type {Card} */
    const card = {
      id: env.id(),
      title: titleOf(spec.title ?? "", spec.prompt),
      prompt: spec.prompt,
      agent: spec.agent,
      column: "todo",
      created: at,
      updated: at,
    };
    cards.push(card);
    persist();
    return card;
  };

  /**
   * Change a card; `keep` writes the board.
   * @param {string} id
   * @param {Partial<Card>} patch
   * @param {boolean} [keep]
   */
  const update = (id, patch, keep = true) => {
    const card = find(id);
    if (!card) return undefined;
    Object.assign(card, patch, { updated: env.now() });
    if (keep) persist();
    return card;
  };

  /**
   * Put a card in a column, before the card at `index` there (the end when absent).
   * @param {string} id
   * @param {Column} to
   * @param {number} [index]
   */
  const move = (id, to, index) => {
    const card = find(id);
    if (!card) return undefined;
    cards = cards.filter((c) => c !== card);
    card.column = to;
    card.updated = env.now();
    const others = cards.filter((c) => c.column === to);
    const before = index === undefined ? undefined : others[index];
    const at = before ? cards.indexOf(before) : cards.length;
    cards.splice(at, 0, card);
    persist();
    return card;
  };

  const remove = (/** @type {string} */ id) => {
    const card = find(id);
    if (!card) return undefined;
    cards = cards.filter((c) => c !== card);
    persist();
    return card;
  };

  /** Remove every card in Done. */
  const clearDone = () => {
    const before = cards.length;
    cards = cards.filter((c) => c.column !== "done");
    persist();
    return before - cards.length;
  };

  return { ready, all: () => [...cards], find, column, add, update, move, remove, clearDone };
}
