// The palette's matching, without a DOM so vitest can test it: what the person typed against the
// commands (or the items a command asked to pick from), and the history that ranks them.

/**
 * How well `query` matches `text`: its characters in order, with runs, word starts and an early first
 * hit counting more. 0 is no match; an empty query matches everything with 1.
 */
export function score(query, text) {
  const q = query.trim().toLowerCase();
  if (q === "") return 1;
  const t = text.toLowerCase();
  let total = 0;
  let at = -1;
  let run = 0;
  for (const char of q) {
    if (char === " ") continue;
    const next = t.indexOf(char, at + 1);
    if (next === -1) return 0;
    run = next === at + 1 ? run + 1 : 0;
    const wordStart = next === 0 || /[\s.\-_]/.test(t[next - 1] ?? "");
    total += 1 + run * 2 + (wordStart ? 3 : 0);
    at = next;
  }
  const first = t.indexOf(q[0] ?? "");
  return total + (first === 0 ? 5 : 0) + 1 / (1 + t.length);
}

/** The words an entry matches on: its label, its id and its keywords. */
function haystacks(entry) {
  return [entry.label ?? entry.title ?? "", entry.id ?? "", ...(entry.keywords ?? [])];
}

/**
 * Entries that match `query`, best first. With an empty query, recently used entries (in `history`
 * order) come first, then the rest in their given order.
 */
export function filter(query, entries, history = []) {
  const recent = new Map(history.map((id, index) => [id, index]));
  const scored = entries
    .map((entry, index) => ({
      entry,
      index,
      score: Math.max(...haystacks(entry).map((text) => score(query, text))),
    }))
    .filter((row) => row.score > 0);
  const empty = query.trim() === "";
  scored.sort((a, b) => {
    if (empty) {
      const ra = recent.get(a.entry.id) ?? Number.POSITIVE_INFINITY;
      const rb = recent.get(b.entry.id) ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.index - b.index;
    }
    return b.score - a.score || a.index - b.index;
  });
  return scored.map((row) => row.entry);
}

/** The history with `id` moved to the front, at most `max` long. */
export function remember(history, id, max) {
  return [id, ...history.filter((other) => other !== id)].slice(0, Math.max(0, max));
}
