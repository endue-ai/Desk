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
 */

export const FILTERS = /** @type {const} */ (["all", "fact", "episode"]);

export const LABELS = {
  all: "Everything",
  fact: "Facts",
  episode: "Conversations",
};

/** Who wrote an entry, for people. */
export function writerName(by) {
  if (by === "person") return "you";
  if (by === "eris") return "Eris";
  if (by.startsWith("agent:")) return `agent ${by.slice("agent:".length)}`;
  return by;
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

/** The question before forgetting everything of `filter`. */
export function forgetAllQuestion(filter) {
  if (filter === "fact") return "Forget every fact Eris keeps about you? This cannot be undone.";
  if (filter === "episode") return "Forget every conversation Eris keeps? This cannot be undone.";
  return "Forget everything Eris remembers? This cannot be undone.";
}
