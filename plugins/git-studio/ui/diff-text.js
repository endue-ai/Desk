// A diff line's text as the viewer draws it: the words that changed against its partner line, and
// light syntax colours (strings, comments, numbers, keywords) for the common languages. Both give
// ranges; spans() turns a line and its ranges into DOM nodes.

/** @typedef {{ start: number, end: number, cls: string }} Range */

const TOKEN = /(\w+|\s+|[^\w\s])/g;
const MAX_TOKENS = 400;

/**
 * Where `before` and `after` differ, as ranges in each (a longest common subsequence of tokens).
 * @param {string} before @param {string} after
 * @returns {{ before: Range[], after: Range[] }}
 */
export function wordDiff(before, after) {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return affix(before, after);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] =
        a[i] === b[j]
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
  /** @type {Range[]} */
  const left = [];
  /** @type {Range[]} */
  const right = [];
  let i = 0;
  let j = 0;
  let x = 0;
  let y = 0;
  const mark = (
    /** @type {Range[]} */ list,
    /** @type {number} */ start,
    /** @type {number} */ end,
  ) => {
    const last = list[list.length - 1];
    if (last && last.end === start) last.end = end;
    else list.push({ start, end, cls: "word" });
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      x += (a[i] ?? "").length;
      y += (b[j] ?? "").length;
      i++;
      j++;
    } else if (
      j < b.length &&
      (i >= a.length || (table[i * cols + j + 1] ?? 0) >= (table[(i + 1) * cols + j] ?? 0))
    ) {
      const len = (b[j] ?? "").length;
      mark(right, y, y + len);
      y += len;
      j++;
    } else {
      const len = (a[i] ?? "").length;
      mark(left, x, x + len);
      x += len;
      i++;
    }
  }
  // When almost everything changed, word marks are noise: the line's own colour says it.
  const share = (/** @type {Range[]} */ list, /** @type {string} */ text) =>
    list.reduce((n, r) => n + r.end - r.start, 0) / Math.max(1, text.length);
  if (share(left, before) > 0.7 && share(right, after) > 0.7) return { before: [], after: [] };
  return { before: left, after: right };
}

/** The changed middle between a common prefix and suffix, for very long lines. */
function affix(/** @type {string} */ a, /** @type {string} */ b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return {
    before: start < a.length - end ? [{ start, end: a.length - end, cls: "word" }] : [],
    after: start < b.length - end ? [{ start, end: b.length - end, cls: "word" }] : [],
  };
}

const KEYWORDS = new Set(
  "abstract as async await break case catch class const continue def default defer delete do elif else enum export extends false final finally fn for from func function go if impl import in interface is let loop match mod module mut new nil none null package private protected pub public return self static struct super switch this throw throws trait true try type typeof undefined use var void where while with yield".split(
    " ",
  ),
);
const SYNTAX =
  /(\/\/.*$|#(?![{[]).*$|\/\*.*?\*\/|<!--.*?-->)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(\d[\d_.]*[a-z]*|0x[0-9a-f]+)\b|\b([A-Za-z_][\w]*)\b/gi;
const HASH_COMMENTS =
  /\.(py|rb|sh|bash|zsh|ya?ml|toml|r|pl|conf|ini|mk|dockerfile)$|(^|\/)(Makefile|Dockerfile)$/i;
const SLASH_COMMENTS =
  /\.(m?[jt]sx?|c|cc|cpp|h|hpp|cs|java|kt|go|rs|swift|scala|dart|php|css|scss|less|json5?)$/i;

/** Syntax ranges for one line of a file named `path`; plain text and unknown kinds get none. */
export function syntax(/** @type {string} */ text, /** @type {string} */ path) {
  const hash = HASH_COMMENTS.test(path);
  const slash = SLASH_COMMENTS.test(path);
  if ((!hash && !slash && !/\.(html?|xml|svg|vue|svelte|md)$/i.test(path)) || text.length > 2000)
    return [];
  /** @type {Range[]} */
  const out = [];
  for (const match of text.matchAll(SYNTAX)) {
    const start = match.index ?? 0;
    const [all, comment, string, number, word] = match;
    if (comment) {
      if ((comment.startsWith("#") && !hash) || (comment.startsWith("//") && !slash)) continue;
      out.push({ start, end: start + all.length, cls: "syn-comment" });
    } else if (string) out.push({ start, end: start + all.length, cls: "syn-string" });
    else if (number) out.push({ start, end: start + all.length, cls: "syn-number" });
    else if (word && KEYWORDS.has(word))
      out.push({ start, end: start + all.length, cls: "syn-keyword" });
    else if (word && /^[A-Z][a-z]/.test(word))
      out.push({ start, end: start + all.length, cls: "syn-type" });
  }
  return out;
}

/**
 * The line's text as spans: syntax classes underneath, changed words on top.
 * @param {Document} doc @param {string} text @param {Range[]} syn @param {Range[]} words
 */
export function spans(doc, text, syn, words) {
  const cuts = new Set([0, text.length]);
  for (const r of [...syn, ...words]) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((x, y) => x - y);
  const frag = doc.createDocumentFragment();
  for (let k = 0; k < points.length - 1; k++) {
    const start = /** @type {number} */ (points[k]);
    const end = /** @type {number} */ (points[k + 1]);
    if (end <= start) continue;
    const piece = text.slice(start, end);
    const classes = [...syn, ...words]
      .filter((r) => r.start <= start && r.end >= end)
      .map((r) => r.cls);
    if (classes.length === 0) frag.append(doc.createTextNode(piece));
    else {
      const span = doc.createElement("span");
      span.className = classes.join(" ");
      span.textContent = piece;
      frag.append(span);
    }
  }
  return frag;
}
