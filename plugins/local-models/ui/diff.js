// Line diffs for edits a model proposes: the shortest edit script between two texts (Myers), as
// hunks with a few lines of context around each change, and the counts of lines added and removed.

/**
 * @typedef {{ type: "same" | "add" | "del", text: string, a?: number, b?: number }} Line
 * @typedef {{ aStart: number, bStart: number, lines: Line[] }} Hunk
 */

/** @param {string} text */
const split = (text) =>
  text === "" ? [] : text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");

/**
 * Every line of both texts in order, each the same, added or removed.
 * @param {string} before @param {string} after @returns {Line[]}
 */
export function diffLines(before, after) {
  const a = split(before);
  const b = split(after);
  const n = a.length;
  const m = b.length;
  const max = n + m;
  /** @type {Int32Array[]} */
  const trace = [];
  const v = new Int32Array(2 * max + 2);
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const at = k + max;
      let x = k === -d || (k !== d && v[at - 1] < v[at + 1]) ? v[at + 1] : v[at - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[at] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  /** @type {Line[]} */
  const out = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && t[k - 1 + max] < t[k + 1 + max]) ? k + 1 : k - 1;
    const prevX = t[prevK + max];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ type: "same", text: a[x - 1], a: x, b: y });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push({ type: "add", text: b[y - 1], b: y });
      else out.push({ type: "del", text: a[x - 1], a: x });
    }
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

/** The changes as hunks, `context` lines of what stayed around each. @param {Line[]} lines @param {number} [context] @returns {Hunk[]} */
export function hunks(lines, context = 3) {
  /** @type {Hunk[]} */
  const out = [];
  /** @type {Hunk | null} */
  let current = null;
  let lastChange = -Infinity;
  lines.forEach((line, i) => {
    if (line.type === "same") return;
    const from = Math.max(0, i - context);
    if (!current || from > lastChange + context + 1) {
      const first = lines[from];
      current = {
        aStart: first.a ?? first.b ?? 1,
        bStart: first.b ?? first.a ?? 1,
        lines: lines.slice(from, i),
      };
      out.push(current);
    } else current.lines.push(...lines.slice(lastChange + 1, i));
    current.lines.push(line);
    lastChange = i;
  });
  for (const h of out) {
    const end = lines.indexOf(h.lines.at(-1) ?? lines[0]);
    h.lines.push(...lines.slice(end + 1, end + 1 + context).filter((l) => l.type === "same"));
  }
  return out;
}

/** Lines added and removed. @param {Line[]} lines */
export function counts(lines) {
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "del").length,
  };
}

/** The diff in unified form, for copying. @param {string} path @param {Hunk[]} hs */
export function unified(path, hs) {
  const body = hs.flatMap((h) => {
    const a = h.lines.filter((l) => l.type !== "add").length;
    const b = h.lines.filter((l) => l.type !== "del").length;
    return [
      `@@ -${h.aStart},${a} +${h.bStart},${b} @@`,
      ...h.lines.map((l) => `${l.type === "add" ? "+" : l.type === "del" ? "-" : " "}${l.text}`),
    ];
  });
  return [`--- a/${path}`, `+++ b/${path}`, ...body].join("\n");
}
