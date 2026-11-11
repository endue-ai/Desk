// What the memory inspector shows, without a DOM: rows from memory entries (specs/memory/v0), the
// kinds to filter by, and the words for when and by whom. Pure functions, unit tested on their own.

/** @typedef {import("@endue-ai/bridge").MemoryEntry} Entry */
/** @typedef {"all" | "fact" | "episode"} Filter */

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {"fact" | "episode"} kind
 * @property {string} text      the fact, or what was asked
 * @property {string} [answer]  what Eris answered, for an episode
 * @property {string} meta      who and when, for people
 * @property {string[]} tags
 * @property {string} [snippet] the words a search matched
 * @property {boolean} long     too long to show whole in the list: a few lines until asked for all
 */

export const FILTERS = /** @type {const} */ (["all", "fact", "episode"]);

export const LABELS = {
  all: "All",
  fact: "Facts",
  episode: "Conversations",
};

/** This plugin's id: what the person keeps or edits in this page is written by it. */
export const SELF = "endue.memory";

/** More characters than this (asked and answered together) and a row shows a few lines of them. */
export const LONG = 200;

/** Who wrote an entry, for people: another plugin by the last word of its id, never the id. */
export function writerName(by) {
  if (by === "person" || by === SELF) return "you";
  if (by === "eris") return "Eris";
  if (by.startsWith("agent:")) return `agent ${by.slice("agent:".length)}`;
  const word = by
    .slice(by.lastIndexOf(".") + 1)
    .replace(/[-_]+/g, " ")
    .trim();
  return word ? `the ${word[0]?.toUpperCase()}${word.slice(1)} plugin` : by;
}

/** A date for people: "5 Nov 2026, 09:12" in the local time zone. */
export function when(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One row per entry, in the order given; `snippets` by id come from a search.
 * @param {Entry[]} entries
 * @param {Map<string, string>} [snippets]
 * @returns {Row[]}
 */
export function rows(entries, snippets = new Map()) {
  return entries.map((entry) => {
    const snippet = snippets.get(entry.id);
    if (entry.kind === "fact") {
      const edited = entry.updated ? ` · edited ${when(entry.updated)}` : "";
      return {
        id: entry.id,
        kind: "fact",
        text: entry.text,
        meta: `Kept by ${writerName(entry.by)} · ${when(entry.at)}${edited}`,
        tags: entry.tags ?? [],
        long: entry.text.length > LONG,
        ...(snippet ? { snippet } : {}),
      };
    }
    const steps = entry.steps?.length
      ? ` · ${entry.steps.length} errand${entry.steps.length > 1 ? "s" : ""}`
      : "";
    return {
      id: entry.id,
      kind: "episode",
      text: entry.asked,
      answer: entry.answered,
      meta: `${when(entry.at)}${steps}`,
      tags: [],
      long: entry.asked.length + entry.answered.length > LONG,
      ...(snippet ? { snippet } : {}),
    };
  });
}

/** What the list says when it is empty. */
export function emptyText(filter, query) {
  if (query) return `Nothing Eris remembers matches “${query}”.`;
  if (filter === "fact") return "Eris keeps no facts about you yet.";
  if (filter === "episode") return "Eris keeps no conversations yet.";
  return "Eris remembers nothing yet. What she keeps shows here, and you can edit or forget it.";
}

const NOUNS = {
  all: ["entry", "entries"],
  fact: ["fact", "facts"],
  episode: ["conversation", "conversations"],
};

/** `n` of what `filter` shows: "1 fact", "3 entries". */
export function counted(filter, n) {
  const [one, many] = NOUNS[/** @type {Filter} */ (filter)];
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The question before forgetting everything of `filter`. `count` entries are shown; it is said only
 * when it is all of them (no search, no page cut short).
 * @param {{ filter: Filter, count: number, more: boolean, query: string }} shown
 * @returns {import("./ask.js").Question}
 */
export function forgetAllQuestion({ filter, count, more, query }) {
  const known = !query && !more && count > 0;
  const one = NOUNS[filter][0];
  const these = !known ? "" : count === 1 ? `the one ${one}` : `the ${counted(filter, count)}`;
  const what = {
    all: [
      "Forget everything?",
      `Eris will no longer know ${these || "anything"} she remembers, facts and conversations alike.`,
      "Forget everything",
    ],
    fact: [
      "Forget every fact?",
      `Eris will no longer know ${these || "any of the facts"} she keeps about you.`,
      known ? `Forget ${counted(filter, count)}` : "Forget every fact",
    ],
    episode: [
      "Forget every conversation?",
      `Eris will no longer have ${these || "any of the conversations"} she keeps.`,
      known ? `Forget ${counted(filter, count)}` : "Forget every conversation",
    ],
  }[filter];
  const all = query ? ` All of them, not only those that match “${query}”.` : "";
  return { title: what[0], text: `${what[1]}${all} This cannot be undone.`, yes: what[2] };
}

/** What the status line says once everything of `filter` is forgotten. */
export function forgotText(filter, n) {
  return n === 0 ? "There was nothing to forget." : `Forgot ${counted(filter, n)}.`;
}
