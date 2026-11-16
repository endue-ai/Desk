// A file in conflict, read and written through git alone (the plugin has no file permission): the
// index's stages (ls-files -u), the three-way merge with diff3 markers (merge-file --object-id),
// the chunks it splits into, the text a set of choices makes, and the resolution written back
// (hash-object, update-index, checkout-index), which also marks the file resolved.

/**
 * @typedef {import("./repo.js").Runner} Runner
 * @typedef {{ kind: "same", lines: string[] }} SameChunk
 * @typedef {{ kind: "conflict", index: number, ours: string[], base: string[], theirs: string[] }} ConflictChunk
 * @typedef {SameChunk | ConflictChunk} Chunk
 * @typedef {"ours" | "theirs" | "both" | "both-theirs-first" | "none"} Choice
 * @typedef {{ path: string, mode: string, stages: Record<1 | 2 | 3, string | undefined>,
 *   chunks: Chunk[], conflicts: number, binary: boolean, eol: string, endsWithNewline: boolean }} ConflictFile
 */

const EMPTY = "";
const MARK = { ours: "<<<<<<< ", base: "||||||| ", split: "=======", theirs: ">>>>>>> " };

/** `ls-files -u -z`: `mode sha stage\tpath`, by stage. */
export function parseStages(/** @type {string} */ out) {
  /** @type {Record<1 | 2 | 3, string | undefined>} */
  const stages = { 1: undefined, 2: undefined, 3: undefined };
  let mode = "100644";
  for (const entry of out.split("\0")) {
    const match = /^(\d+) ([0-9a-f]+) ([123])\t/.exec(entry);
    if (!match) continue;
    const stage = /** @type {1 | 2 | 3} */ (Number(match[3]));
    stages[stage] = match[2];
    if (stage !== 1) mode = match[1] ?? mode;
  }
  return { stages, mode };
}

/** Split merge-file's diff3 output into the lines both sides agree on and the conflicts. */
export function parseMerged(/** @type {string} */ text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  if (endsWithNewline) lines.pop();
  /** @type {Chunk[]} */
  const chunks = [];
  /** @type {SameChunk | null} */
  let same = null;
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = /** @type {string} */ (lines[i]);
    if (!line.startsWith(MARK.ours)) {
      if (!same) {
        same = { kind: "same", lines: [] };
        chunks.push(same);
      }
      same.lines.push(line);
      continue;
    }
    same = null;
    /** @type {ConflictChunk} */
    const chunk = { kind: "conflict", index: index++, ours: [], base: [], theirs: [] };
    let side = /** @type {"ours" | "base" | "theirs"} */ ("ours");
    for (i++; i < lines.length; i++) {
      const next = /** @type {string} */ (lines[i]);
      if (side === "ours" && next.startsWith(MARK.base)) side = "base";
      else if (side !== "theirs" && next === MARK.split) side = "theirs";
      else if (side === "theirs" && next.startsWith(MARK.theirs)) break;
      else chunk[side].push(next);
    }
    chunks.push(chunk);
  }
  return { chunks, conflicts: index, eol, endsWithNewline };
}

/** The lines a conflict becomes for a choice; null while it has none. */
export function resolveChunk(
  /** @type {ConflictChunk} */ chunk,
  /** @type {Choice | undefined} */ choice,
) {
  if (choice === "ours") return chunk.ours;
  if (choice === "theirs") return chunk.theirs;
  if (choice === "both") return [...chunk.ours, ...chunk.theirs];
  if (choice === "both-theirs-first") return [...chunk.theirs, ...chunk.ours];
  if (choice === "none") return [];
  return null;
}

/**
 * The file's text for `choices` (by conflict index); an unchosen conflict keeps its markers, so the
 * text is always whole. `custom` replaces a conflict's lines with what the person (or AI) wrote.
 * @param {ConflictFile} file @param {Map<number, Choice>} choices @param {Map<number, string[]>} [custom]
 */
export function compose(file, choices, custom = new Map()) {
  /** @type {string[]} */
  const out = [];
  for (const chunk of file.chunks) {
    if (chunk.kind === "same") out.push(...chunk.lines);
    else {
      const lines = custom.get(chunk.index) ?? resolveChunk(chunk, choices.get(chunk.index));
      if (lines) out.push(...lines);
      else
        out.push(
          `${MARK.ours}ours`,
          ...chunk.ours,
          MARK.split,
          ...chunk.theirs,
          `${MARK.theirs}theirs`,
        );
    }
  }
  const text = out.join(file.eol);
  return file.endsWithNewline && out.length > 0 ? text + file.eol : text;
}

/** Whether a text still has conflict markers in it. */
export const hasMarkers = (/** @type {string} */ text) => /^(<{7}|={7}|>{7})( |$)/m.test(text);

/** @param {Runner} git @param {string} root */
export function createConflicts(git, root) {
  const at = { cwd: root };
  const blob = async (/** @type {string | undefined} */ sha) =>
    sha ? (await git.run(["cat-file", "blob", sha], at)).stdout : EMPTY;
  const write = async (/** @type {string} */ text) =>
    (await git.run(["hash-object", "-w", "--stdin"], { cwd: root, input: text })).stdout.trim();

  return {
    /** Read a conflicted file into chunks. @returns {Promise<ConflictFile>} */
    async load(/** @type {string} */ path) {
      const { stdout } = await git.run(["ls-files", "-u", "-z", "--", path], at);
      const { stages, mode } = parseStages(stdout);
      const ids = await Promise.all(
        [stages[2], stages[1], stages[3]].map(async (sha) => sha ?? (await write(EMPTY))),
      );
      const [ours = "", base = "", theirs = ""] = ids;
      const sides = await Promise.all([blob(stages[2]), blob(stages[3])]);
      const binary = sides.some((text) => text.includes("\0"));
      if (binary)
        return {
          path,
          mode,
          stages,
          chunks: [],
          conflicts: 1,
          binary,
          eol: "\n",
          endsWithNewline: true,
        };
      // merge-file exits with the number of conflicts, so any small code is an answer.
      const merged = await git.run(
        [
          "merge-file",
          "-p",
          "--diff3",
          "--object-id",
          "-L",
          "ours",
          "-L",
          "base",
          "-L",
          "theirs",
          ours,
          base,
          theirs,
        ],
        { cwd: root, ok: Array.from({ length: 127 }, (_, i) => i + 1) },
      );
      return { path, mode, stages, binary, ...parseMerged(merged.stdout) };
    },
    /** Write the resolved text as the file's one stage and into the working copy. */
    async save(/** @type {ConflictFile} */ file, /** @type {string} */ text) {
      const sha = await write(text);
      await git.run(["update-index", "--cacheinfo", `${file.mode},${sha},${file.path}`], at);
      await git.run(["checkout-index", "-f", "--", file.path], at);
    },
    /** Take one side whole (binary files, or a file deleted on one side), or delete the file. */
    async take(/** @type {string} */ path, /** @type {"ours" | "theirs" | "delete"} */ side) {
      if (side === "delete") return git.run(["rm", "-q", "--", path], at);
      await git.run(["checkout", `--${side}`, "--", path], at);
      return git.run(["add", "--", path], at);
    },
  };
}
