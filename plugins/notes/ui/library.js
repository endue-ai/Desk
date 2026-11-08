// ~/Notes on disk: the dated name endue.notes.new writes, and every note under the folder for the
// palette's Notes group (endue.notes.find, contributes.paletteProviders). It lists and reads under the
// plugin's own grant, never asks for another, keeps what it read by path and reads a note again only
// when its size or modification time changed. Notes the palette already lists are left out.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").DirEntry} DirEntry
 * @typedef {{ path: string, name: string, size?: number, modifiedAt?: string }} Found
 * @typedef {Found & { text: string, lower: string }} OnDisk
 * @typedef {{ command: string, title: string, args: { path: string } }} Action
 * @typedef {{ id: string, title: string, detail: string, kind: string, actions: Action[] }} Result
 */

export const ROOT = "~/Notes";
/** The manifest's own grant, ${home}/Notes/**. @type {import("@endue-ai/bridge").FsReadPermission} */
const READ = { permission: "fs:read", paths: [`${ROOT}/**`] };
/** The files notes opens (contributes.files). */
const NOTE = /\.(md|txt)$/i;
/** Folders below ~/Notes the walk goes into, and the notes it keeps. */
const DEEPEST = 8;
const MOST = 1000;
/** Larger notes are found by their name only. */
const LARGEST = 1024 * 1024;
/** Reads at once. */
const AT_ONCE = 8;
const LINE = 120;

const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");

/** The local date: 2026-11-08. */
export const dateOf = (/** @type {Date} */ now) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const timeOf = (/** @type {Found} */ note) => Date.parse(note.modifiedAt ?? "") || 0;

/** What tells a read apart from the next: size and modification time, none without a time. */
const stampOf = (/** @type {Found} */ note) =>
  note.modifiedAt === undefined ? undefined : `${note.size ?? ""}@${note.modifiedAt}`;

/** The first line that holds one of the words, trimmed and cut to LINE characters; none for none. */
const lineOf = (/** @type {string} */ text, /** @type {string[]} */ words) => {
  if (words.length === 0) return "";
  const line = text.split("\n").find((l) => words.some((w) => l.toLowerCase().includes(w))) ?? "";
  return line.trim().slice(0, LINE);
};

/**
 * A note as the palette lists it: its name, then the matching line and its path. Enter opens it.
 * @param {Found} note
 * @param {string} line
 * @returns {Result}
 */
const resultOf = (note, line) => ({
  id: note.path,
  title: note.name,
  detail: line ? `${line} · ${note.path}` : note.path,
  kind: "note",
  actions: [
    { command: "endue.notes.search-open", title: "Open in Notes", args: { path: note.path } },
  ],
});

/**
 * @param {Pick<PluginContext, "bridge">} ctx
 */
export function createLibrary({ bridge }) {
  /**
   * What was read, by path, lowercased once for matching.
   * @type {Map<string, { stamp: string, text: string, lower: string }>}
   */
  const kept = new Map();
  /** The walk on its way, which asks meanwhile share. @type {Promise<OnDisk[]> | undefined} */
  let walking;

  const list = async (/** @type {string} */ path) =>
    /** @type {DirEntry[]} */ ((await bridge.call("fs.list", { path, scope: READ })).entries);

  /** A note's text: kept while it is unchanged, read again otherwise. */
  const read = async (/** @type {Found} */ note) => {
    if ((note.size ?? 0) > LARGEST) return { ...note, text: "", lower: "" };
    const stamp = stampOf(note);
    const held = kept.get(note.path);
    if (stamp !== undefined && held?.stamp === stamp)
      return { ...note, text: held.text, lower: held.lower };
    const text = await bridge
      .call("fs.read", { path: note.path, encoding: "utf8", scope: READ })
      .then(({ content }) => content)
      .catch(() => held?.text ?? "");
    const lower = text.toLowerCase();
    if (stamp === undefined) kept.delete(note.path);
    else kept.set(note.path, { stamp, text, lower });
    return { ...note, text, lower };
  };

  /** Every note under ~/Notes, with its text; hidden entries and links are not followed. */
  const walk = async () => {
    /** @type {Found[]} */
    const found = [];
    /** @type {Array<[string, number]>} */
    const folders = [[ROOT, 0]];
    for (let next = folders.shift(); next && found.length < MOST; next = folders.shift()) {
      const [folder, depth] = next;
      // A folder below ~/Notes that cannot be listed is left out; ~/Notes itself answers nothing.
      const entries = await list(folder).catch((error) => {
        if (folder === ROOT) throw error;
        return [];
      });
      for (const { name, kind, size, modifiedAt } of entries) {
        if (name.startsWith(".")) continue;
        const path = `${folder}/${name}`;
        if (kind === "dir" && depth < DEEPEST) folders.push([path, depth + 1]);
        if (kind === "file" && NOTE.test(name) && found.length < MOST)
          found.push({ path, name, size, modifiedAt });
      }
    }
    // Notes gone from disk are forgotten.
    const paths = new Set(found.map((f) => f.path));
    for (const path of kept.keys()) if (!paths.has(path)) kept.delete(path);
    /** @type {OnDisk[]} */
    const notes = [];
    for (let i = 0; i < found.length; i += AT_ONCE)
      notes.push(...(await Promise.all(found.slice(i, i + AT_ONCE).map(read))));
    return notes;
  };

  const onDisk = () => {
    walking ??= walk().finally(() => {
      walking = undefined;
    });
    return walking;
  };

  return {
    /**
     * The palette's answer for a PaletteQuery: every word in the name or the text, the notes whose
     * name holds every word first, then the newest. A missing or refused ~/Notes answers nothing.
     * @param {unknown} args
     * @param {Set<string>} listed the paths the palette already lists (published open notes)
     * @returns {Promise<{ results: Result[] }>}
     */
    async find(args, listed) {
      const { query, limit } = /** @type {{ query?: unknown, limit?: unknown }} */ (args ?? {});
      const words =
        typeof query === "string" ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
      if (words.length === 0) return { results: [] };
      const most = typeof limit === "number" && Number.isInteger(limit) ? limit : 5;
      const notes = await onDisk().catch(() => /** @type {OnDisk[]} */ ([]));
      const hits = notes.flatMap((note) => {
        if (listed.has(note.path)) return [];
        const name = note.name.toLowerCase();
        // The words the name does not hold must be in the text.
        const inText = words.filter((w) => !name.includes(w));
        return inText.every((w) => note.lower.includes(w)) ? [{ note, inText }] : [];
      });
      const titled = (/** @type {{ inText: string[] }} */ hit) => Number(hit.inText.length === 0);
      hits.sort((a, b) => titled(b) - titled(a) || timeOf(b.note) - timeOf(a.note));
      const shown = hits.slice(0, Math.min(Math.max(most, 1), 50));
      return {
        results: shown.map(({ note, inText }) => resultOf(note, lineOf(note.text, inText))),
      };
    },

    /** Where a new note goes: ~/Notes/2026-11-08.md, else the first free 2026-11-08-<n>.md. */
    async fresh(/** @type {Date} */ now) {
      const day = dateOf(now);
      const names = await list(ROOT).catch(() => /** @type {DirEntry[]} */ ([]));
      const taken = new Set(names.map((entry) => entry.name.toLowerCase()));
      let name = `${day}.md`;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${day}-${n}.md`;
      return `${ROOT}/${name}`;
    },
  };
}
