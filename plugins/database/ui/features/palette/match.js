// The palette's own matching (plugins/palette/ui/match.js), over the names of the schema caches: a
// copy of its `score`, which a test holds equal to the palette's, and its rating, where the name a
// row shows beats the qualified name and a query held whole leaves fragments out. Each plugin is
// served on its own origin, so the palette's module cannot be imported here. The best few of many
// names are kept as they are found, never all of them sorted. Pure: the worker and the page run it.

/** Where a word starts: after a space or punctuation. */
const BOUNDARY = /[\s.\-_'’/:()[\]]/;
/** What a query found whole in the text adds: such matches rank above fragmented ones. */
export const CONTIGUOUS = 100;

/**
 * How well a query matches a text, both lowercase, as the palette scores it: its characters in
 * order, each one starting a word or continuing a run; 0 is no match.
 * @param {string} q The query, trimmed and lowercase, not empty.
 * @param {string} t
 */
export function scoreLower(q, t) {
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
      for (let i = t.indexOf(char, at + 1); i !== -1; i = t.indexOf(char, i + 1)) {
        if (i === 0 || BOUNDARY.test(t[i - 1] ?? "")) {
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

/** The palette's `score`: any case, an empty query matches everything with 1. */
export function score(/** @type {string} */ query, /** @type {string} */ text) {
  const q = query.trim().toLowerCase();
  return q === "" ? 1 : scoreLower(q, text.toLowerCase());
}

/**
 * @typedef {{ name: string, qualified: string, rank: number }} Named
 *   `name` is what the row shows, `qualified` the name with its schema (and table), both lowercase;
 *   `rank` the kind's place in the order of ties.
 * @typedef {{ item: Named, block: number, at: number, score: number, tier: number }} Found
 */

/** Rated finds, best first: by tier, by score, by the kind's rank, then where they were found. */
const better = (/** @type {Found} */ a, /** @type {Found} */ b) =>
  b.tier - a.tier ||
  b.score - a.score ||
  a.item.rank - b.item.rank ||
  a.block - b.block ||
  a.at - b.at;

/** Put a find into a list kept best first and at most `limit` long. */
function keep(
  /** @type {Found[]} */ list,
  /** @type {Found} */ found,
  /** @type {number} */ limit,
) {
  if (list.length >= limit && better(found, /** @type {Found} */ (list.at(-1))) >= 0) return;
  let i = list.length;
  while (i > 0 && better(found, /** @type {Found} */ (list[i - 1])) < 0) i--;
  list.splice(i, 0, found);
  if (list.length > limit) list.pop();
}

/**
 * The best `limit` names of the blocks for a query, best first, each with its block's index. Once one holds the query whole,
 * fragments are left out, as the palette leaves them out.
 * @template {Named} T
 * @param {readonly (readonly T[])[]} blocks
 * @param {string} query
 * @param {number} limit
 * @returns {{ item: T, block: number }[]}
 */
export function best(blocks, query, limit) {
  const q = query.trim().toLowerCase();
  if (q === "" || limit < 1) return [];
  /** @type {Found[]} */
  const whole = [];
  /** @type {Found[]} */
  const parts = [];
  for (let block = 0; block < blocks.length; block++) {
    const items = /** @type {readonly T[]} */ (blocks[block]);
    for (let at = 0; at < items.length; at++) {
      const item = /** @type {T} */ (items[at]);
      const shown = scoreLower(q, item.name);
      const other = item.qualified === item.name ? 0 : scoreLower(q, item.qualified);
      const top = Math.max(shown, other);
      if (top === 0) continue;
      const held = top >= CONTIGUOUS;
      if (!held && whole.length > 0) continue;
      const found = { item, block, at, score: top, tier: (held ? 2 : 0) + (shown > 0 ? 1 : 0) };
      keep(held ? whole : parts, found, limit);
    }
  }
  return (whole.length > 0 ? whole : parts).map((f) => ({
    item: /** @type {T} */ (f.item),
    block: f.block,
  }));
}
