// The palette's matching, without a DOM so vitest can test it: what the person typed against the
// commands (or the items a command asked to pick from), and the history that ranks them.

/** Where a word starts in a label: after a space or punctuation. */
const BOUNDARY = /[\s.\-_'’/:()[\]]/;
/** What a query found whole in the text adds: such matches rank above fragmented ones. */
export const CONTIGUOUS = 100;

/**
 * How well `query` matches `text`: its characters in order, each one starting a word or continuing
 * a run (so "opf" finds "Open a file" and "theme" does not find "the open message"), with runs and
 * word starts counting more and the whole query found in one piece counting most. 0 is no match;
 * an empty query matches everything with 1.
 */
export function score(query, text) {
  const q = query.trim().toLowerCase();
  if (q === "") return 1;
  const t = text.toLowerCase();
  let total = 0;
  let at = -1;
  let run = 0;
  for (const char of q) {
    if (char === " ") {
      run = 0;
      continue;
    }
    let next = -1;
    if (at >= 0 && t[at + 1] === char) next = at + 1;
    else {
      for (let i = at + 1; i < t.length; i++) {
        if (t[i] === char && (i === 0 || BOUNDARY.test(t[i - 1] ?? ""))) {
          next = i;
          break;
        }
      }
    }
    if (next === -1) return 0;
    run = next === at + 1 ? run + 1 : 0;
    const wordStart = next === 0 || BOUNDARY.test(t[next - 1] ?? "");
    total += 1 + run * 2 + (wordStart ? 3 : 0);
    at = next;
  }
  const first = t.indexOf(q[0] ?? "");
  const whole = t.includes(q) ? CONTIGUOUS : 0;
  return total + whole + (first === 0 ? 5 : 0) + 1 / (1 + t.length);
}

/**
 * How an entry matches: by its label (the words its row shows) or by its id and keywords alone, and
 * how well. `tier` orders first: holding the query whole beats a fragment, then the label beats the
 * rest, so `sett` finds Settings before the commands that only list "settings" among their keywords
 * and "New terminal" comes before a command whose keywords start with "terminal".
 * @param {string} query
 * @param {string} label
 * @param {string[]} others
 */
function rate(query, label, others) {
  const shown = score(query, label);
  const best = Math.max(shown, ...others.map((text) => score(query, text)));
  const whole = best >= CONTIGUOUS;
  return { score: best, whole, tier: (whole ? 2 : 0) + (shown > 0 ? 1 : 0) };
}

/** Rated rows, best first: by tier, then by score, then in their given order. */
const better = (a, b) => b.tier - a.tier || b.score - a.score || a.index - b.index;

/** The entries that match, rated; once something holds the query whole, fragments are left out. */
function matches(query, entries) {
  const all = entries
    .map((entry, index) => ({
      entry,
      index,
      ...rate(query, entry.label ?? entry.title ?? "", [entry.id ?? "", ...(entry.keywords ?? [])]),
    }))
    .filter((row) => row.score > 0);
  return all.some((row) => row.whole) ? all.filter((row) => row.whole) : all;
}

/**
 * Entries that match `query`, best first. With an empty query, recently used entries (in `history`
 * order) come first, then the rest in their given order. Once something holds the query whole,
 * fragmented matches are left out.
 */
export function filter(query, entries, history = []) {
  const recent = new Map(history.map((id, index) => [id, index]));
  const scored = matches(query, entries);
  const empty = query.trim() === "";
  scored.sort((a, b) => {
    if (empty) {
      const ra = recent.get(a.entry.id) ?? Number.POSITIVE_INFINITY;
      const rb = recent.get(b.entry.id) ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.index - b.index;
    }
    return better(a, b);
  });
  return scored.map((row) => row.entry);
}

/** The sections of the first list, in order. */
export const SECTIONS = { recent: "Recent", plugins: "Plugins", commands: "Commands" };

/**
 * The palette's own list: the commands and the plugins' hits (a plugin, or data a plugin published,
 * as searchEntry makes them) in one order. Nothing typed: what the person ran or opened last
 * (`history`), then the plugins, then the commands, each entry marked with its section; published
 * data waits for a query. Typed: as `filter` rates them, a hit by its title (its label) or a plugin
 * by its id too, and a hit ahead of a command that matches as well; a hit the index found in its
 * description or text alone follows the matches, in the index's order.
 */
export function rank(query, commands, hits, history = []) {
  if (query.trim() === "") {
    const recent = new Map(history.map((id, index) => [id, index]));
    const plugins = hits.filter((entry) => entry.hit?.kind === "plugin");
    const used = [...plugins, ...commands]
      .filter((entry) => recent.has(entry.id))
      .sort((a, b) => (recent.get(a.id) ?? 0) - (recent.get(b.id) ?? 0));
    const rest = (entries, section) =>
      entries.filter((entry) => !recent.has(entry.id)).map((entry) => ({ ...entry, section }));
    return [
      ...used.map((entry) => ({ ...entry, section: SECTIONS.recent })),
      ...rest(plugins, SECTIONS.plugins),
      ...rest(commands, SECTIONS.commands),
    ];
  }
  const found = hits.map((entry, index) => ({
    entry,
    index,
    ...rate(query, entry.label ?? "", entry.hit?.kind === "plugin" ? [entry.hit.plugin ?? ""] : []),
  }));
  const listed = matches(query, commands).map((row) => ({
    ...row,
    index: hits.length + row.index,
  }));
  return [...found, ...listed].sort(better).map((row) => row.entry);
}

/** Whether the palette can run a command as it is, with no args: its argsSchema requires none. */
export function runnable(command) {
  const required = command.argsSchema?.required;
  return !Array.isArray(required) || required.length === 0;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The registry's commands (cmd.list) as the palette lists them: A to Z by title, numbers by value,
 * whatever order the plugins registered them in; with their keys (desk.keys.list); without `hidden`
 * and without those it cannot run (they need args).
 */
export function commandEntries(commands, bindings, hidden) {
  return commands
    .filter((command) => !hidden.has(command.id) && runnable(command))
    .map((command) => ({
      id: command.id,
      provider: command.provider,
      label: command.title,
      keywords: command.keywords ?? [],
      keys: bindings.filter((b) => b.command === command.id).map((b) => b.key),
    }))
    .sort((a, b) => collator.compare(a.label, b.label) || (a.id < b.id ? -1 : 1));
}

/** The history with `id` moved to the front, at most `max` long. */
export function remember(history, id, max) {
  return [id, ...history.filter((other) => other !== id)].slice(0, Math.max(0, max));
}
