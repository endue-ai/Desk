// Unified diffs read into files, hunks and numbered lines, and the patches that stage, unstage or
// discard a hunk or some of its lines (for `git apply [--cached] [--reverse] -`).

/**
 * @typedef {" " | "+" | "-" | "\\"} LineKind
 * @typedef {{ kind: LineKind, text: string, old: number | null, new: number | null }} Line
 * @typedef {{ header: string, oldStart: number, oldLines: number, newStart: number, newLines: number,
 *   section: string, lines: Line[] }} Hunk
 * @typedef {{ path: string, oldPath: string, status: "modified" | "added" | "deleted" | "renamed",
 *   binary: boolean, header: string[], hunks: Hunk[], added: number, removed: number }} DiffFile
 */

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** @param {string} raw `a/path` or `"a/quoted path"` */
function unquote(raw) {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) path = JSON.parse(path);
  return path.replace(/^[ab]\//, "");
}

/** @param {string} text the output of git diff */
export function parseDiff(text) {
  /** @type {DiffFile[]} */
  const files = [];
  /** @type {DiffFile | null} */
  let file = null;
  /** @type {Hunk | null} */
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git (".*?"|\S+) (".*?"|\S+)$/.exec(line);
      const oldPath = match ? unquote(match[1] ?? "") : "";
      const path = match ? unquote(match[2] ?? "") : "";
      file = {
        path,
        oldPath,
        status: "modified",
        binary: false,
        header: [line],
        hunks: [],
        added: 0,
        removed: 0,
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk || !/^[ +\-\\]/.test(line)) {
      const h = HUNK.exec(line);
      if (h) {
        oldNo = Number(h[1]);
        newNo = Number(h[3]);
        hunk = {
          header: line,
          oldStart: oldNo,
          oldLines: h[2] === undefined ? 1 : Number(h[2]),
          newStart: newNo,
          newLines: h[4] === undefined ? 1 : Number(h[4]),
          section: h[5] ?? "",
          lines: [],
        };
        file.hunks.push(hunk);
        continue;
      }
      if (hunk) hunk = null;
      file.header.push(line);
      if (line.startsWith("new file")) file.status = "added";
      else if (line.startsWith("deleted file")) file.status = "deleted";
      else if (line.startsWith("rename from ")) {
        file.status = "renamed";
        file.oldPath = line.slice(12);
      } else if (line.startsWith("rename to ")) file.path = line.slice(10);
      else if (line.startsWith("Binary files") || line === "GIT binary patch") file.binary = true;
      else if (line.startsWith("+++ ") && line !== "+++ /dev/null")
        file.path = unquote(line.slice(4));
      else if (line.startsWith("--- ") && line !== "--- /dev/null")
        file.oldPath = unquote(line.slice(4));
      continue;
    }
    const kind = /** @type {LineKind} */ (line[0]);
    const text = line.slice(1);
    if (kind === "+") {
      hunk.lines.push({ kind, text, old: null, new: newNo++ });
      file.added++;
    } else if (kind === "-") {
      hunk.lines.push({ kind, text, old: oldNo++, new: null });
      file.removed++;
    } else if (kind === "\\") hunk.lines.push({ kind, text, old: null, new: null });
    else hunk.lines.push({ kind, text, old: oldNo++, new: newNo++ });
  }
  return files;
}

/**
 * The patch of one hunk, or of the lines `chosen` (indexes into hunk.lines) when given. Applying
 * forward (`reverse` false) the lines not chosen keep the old side: an unchosen `+` is dropped and an
 * unchosen `-` stays as context. Applied with --reverse the new side stays instead.
 * @param {DiffFile} file @param {Hunk} hunk @param {Set<number> | null} [chosen] @param {{ reverse?: boolean }} [options]
 * @returns {string | null} null when nothing would change
 */
export function hunkPatch(file, hunk, chosen = null, options = {}) {
  const reverse = options.reverse === true;
  /** @type {string[]} */
  const body = [];
  let oldCount = 0;
  let newCount = 0;
  let changes = 0;
  hunk.lines.forEach((line, i) => {
    const take = chosen === null || chosen.has(i);
    if (line.kind === " ") {
      body.push(` ${line.text}`);
      oldCount++;
      newCount++;
    } else if (line.kind === "\\") {
      const previous = body[body.length - 1];
      if (previous !== undefined) body.push(`\\${line.text}`);
    } else if (line.kind === "+") {
      if (take) {
        body.push(`+${line.text}`);
        newCount++;
        changes++;
      } else if (reverse) {
        body.push(` ${line.text}`);
        oldCount++;
        newCount++;
      } else body.push("\0drop");
    } else if (line.kind === "-") {
      if (take) {
        body.push(`-${line.text}`);
        oldCount++;
        changes++;
      } else if (!reverse) {
        body.push(` ${line.text}`);
        oldCount++;
        newCount++;
      } else body.push("\0drop");
    }
  });
  if (changes === 0) return null;
  // A "no newline" marker belongs to the line before it; drop it when that line was dropped.
  const kept = [];
  for (let i = 0; i < body.length; i++) {
    const line = /** @type {string} */ (body[i]);
    if (line === "\0drop") continue;
    if (line.startsWith("\\") && body[i - 1] === "\0drop") continue;
    kept.push(line);
  }
  const oldPath = file.status === "added" ? "/dev/null" : `a/${file.oldPath || file.path}`;
  const newPath = file.status === "deleted" ? "/dev/null" : `b/${file.path}`;
  const start = (/** @type {number} */ n, /** @type {number} */ count) =>
    count === 0 ? Math.max(0, n - 1) : n;
  const header = `@@ -${start(hunk.oldStart, oldCount)},${oldCount} +${start(hunk.newStart, newCount)},${newCount} @@${hunk.section ? ` ${hunk.section}` : ""}`;
  return [
    `diff --git a/${file.oldPath || file.path} b/${file.path}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    header,
    ...kept,
    "",
  ].join("\n");
}

/**
 * Side by side: context on both sides, each run of removals beside the run of additions after it.
 * @param {Hunk} hunk
 * @returns {{ left: (Line & { index: number }) | null, right: (Line & { index: number }) | null }[]}
 */
export function pairLines(hunk) {
  /** @type {{ left: (Line & { index: number }) | null, right: (Line & { index: number }) | null }[]} */
  const rows = [];
  const lines = hunk.lines.map((line, index) => ({ ...line, index }));
  for (let i = 0; i < lines.length; ) {
    const line = /** @type {Line & { index: number }} */ (lines[i]);
    if (line.kind === " ") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    if (line.kind === "\\") {
      i++;
      continue;
    }
    const removed = [];
    const added = [];
    while (i < lines.length && lines[i]?.kind === "-") removed.push(lines[i++]);
    while (i < lines.length && (lines[i]?.kind === "+" || lines[i]?.kind === "\\")) {
      const next = /** @type {Line & { index: number }} */ (lines[i++]);
      if (next.kind === "+") added.push(next);
    }
    for (let k = 0; k < Math.max(removed.length, added.length); k++)
      rows.push({ left: removed[k] ?? null, right: added[k] ?? null });
  }
  return rows;
}
