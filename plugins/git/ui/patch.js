// A patch of chosen lines from one hunk, for `git apply`. Pure. Forward (stage) applies the
// index → worktree diff to the index; reverse (unstage, discard) takes a change back from the side
// the diff ends on. A line that is not chosen must still match that side: forward, an unchosen `+`
// is not there yet (dropped) and an unchosen `-` still is (context); reverse, the other way round.

/**
 * @typedef {import("./parse-diff.js").DiffFile} DiffFile
 * @typedef {import("./parse-diff.js").Hunk} Hunk
 * @typedef {import("./parse-diff.js").Line} Line
 */

/**
 * @param {DiffFile} file
 * @param {Hunk} hunk
 * @param {Set<number>} chosen Indexes into `hunk.lines`; every line when absent.
 * @param {boolean} reverse The patch is applied with `--reverse`.
 * @returns {string | null} The patch, or null when the chosen lines change nothing.
 */
export function linesPatch(file, hunk, chosen, reverse) {
  /** @type {string[]} */
  const body = [];
  let oldCount = 0;
  let newCount = 0;
  let changes = 0;
  /** Whether the line before a `\ No newline` note was kept, so the note goes with it. */
  let kept = false;
  hunk.lines.forEach((line, index) => {
    const picked = chosen.has(index);
    if (line.kind === "note") {
      if (kept) body.push(`\\ ${line.text}`);
      return;
    }
    kept = true;
    if (line.kind === "context" || (!picked && line.kind === (reverse ? "add" : "del"))) {
      body.push(` ${line.text}`);
      oldCount++;
      newCount++;
    } else if (!picked) {
      kept = false;
    } else if (line.kind === "add") {
      body.push(`+${line.text}`);
      newCount++;
      changes++;
    } else {
      body.push(`-${line.text}`);
      oldCount++;
      changes++;
    }
  });
  if (changes === 0) return null;
  const oldPath = file.oldPath ?? file.path;
  return [
    `diff --git a/${oldPath} b/${file.path}`,
    `--- ${file.status === "added" ? "/dev/null" : `a/${oldPath}`}`,
    `+++ ${file.status === "deleted" ? "/dev/null" : `b/${file.path}`}`,
    `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`,
    ...body,
    "",
  ].join("\n");
}

/** Every line of a hunk, as `linesPatch` takes them. */
export const allLines = (/** @type {Hunk} */ hunk) => new Set(hunk.lines.map((_, index) => index));
