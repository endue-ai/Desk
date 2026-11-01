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

/** The words an entry matches on: its label, its id and its keywords. */
function haystacks(entry) {
  return [entry.label ?? entry.title ?? "", entry.id ?? "", ...(entry.keywords ?? [])];
}

/**
 * Entries that match `query`, best first. With an empty query, recently used entries (in `history`
 * order) come first, then the rest in their given order. Once something holds the query whole,
 * fragmented matches are left out.
 */
export function filter(query, entries, history = []) {
  const recent = new Map(history.map((id, index) => [id, index]));
  const all = entries
    .map((entry, index) => ({
      entry,
      index,
      score: Math.max(...haystacks(entry).map((text) => score(query, text))),
    }))
    .filter((row) => row.score > 0);
  const whole = all.some((row) => row.score >= CONTIGUOUS);
  const scored = whole ? all.filter((row) => row.score >= CONTIGUOUS) : all;
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
