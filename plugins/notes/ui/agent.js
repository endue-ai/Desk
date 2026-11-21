// What an agent reads and writes through Notes (ADR 0088): the notes in ~/Notes, a note's text, a
// new note with text, and text added to or put in place of a note's. Agents stay in ~/Notes, the
// folder the manifest holds a grant for, so nothing here asks the person for a folder; a note open
// with unsaved edits is read as the person sees it and never written over, since their typing comes
// first. Every write is one fs.write, which keeps the text it replaced as a version (fs.history).
import { dateOf, ROOT } from "./library.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {{ path: string, name: string, text: string, modified: boolean }} Open
 */

const READ = /** @type {const} */ ({ permission: "fs:read", paths: [`${ROOT}/**`] });
const WRITE = /** @type {const} */ ({ permission: "fs:write", paths: [`${ROOT}/**`] });
/** The longest text a read answers by default and at most, in characters. */
export const TEXT = { usual: 20000, most: 200000 };
const NOTE = /\.(md|txt)$/i;

/** A path under ~/Notes as the agent named it: a bare name or a relative path lands in ~/Notes. */
export function notePath(/** @type {unknown} */ value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Name the note: path.");
  let path = value.trim().replace(/\\/g, "/");
  if (path.startsWith("${home}/")) path = `~/${path.slice("${home}/".length)}`;
  if (!path.startsWith("~/") && !path.startsWith("/")) path = `${ROOT}/${path}`;
  if (path.split("/").includes("..") || !path.startsWith(`${ROOT}/`))
    throw new Error(`${value} is not in ${ROOT}: agents read and write notes there only.`);
  return path;
}

/** A new note's file name: the one asked for (with .md when it has no .md or .txt), else dated. */
const nameFor = (/** @type {unknown} */ name, /** @type {Date} */ now) => {
  if (typeof name !== "string" || name.trim() === "") return `${dateOf(now)}.md`;
  const plain = name.trim();
  if (/[/\\\0]/.test(plain) || plain.startsWith("."))
    throw new Error(`${plain} is not a note name.`);
  return NOTE.test(plain) ? plain : `${plain}.md`;
};

/**
 * @param {{ bridge: PluginContext["bridge"], commands: PluginContext["commands"],
 *   open(): Open[], all(): Promise<Array<{ path: string, name: string, size?: number,
 *   modifiedAt?: string, text: string }>>, now(): Date }} deps
 * @returns {Record<string, (args: Record<string, unknown>) => Promise<unknown>>}
 */
export function agentCommands(deps) {
  const { bridge } = deps;
  const openAt = (/** @type {string} */ path) => deps.open().find((note) => note.path === path);
  const disk = async (/** @type {string} */ path) =>
    /** @type {{ content: string }} */ (
      await bridge.call("fs.read", { path, encoding: "utf8", scope: READ })
    ).content;
  const write = (/** @type {string} */ path, /** @type {string} */ content) =>
    bridge.call("fs.write", { path, content, encoding: "utf8", createDirs: true, scope: WRITE });
  /** Refuse to write over the person's unsaved typing. */
  const writable = (/** @type {string} */ path) => {
    if (openAt(path)?.modified)
      throw new Error(`${path} has unsaved edits in Notes; save or revert them first.`);
  };
  const textOf = (/** @type {unknown} */ value) => {
    if (typeof value !== "string") throw new Error("Give the note's text: text.");
    return value;
  };

  return {
    "endue.notes.list": async (a) => {
      const words =
        typeof a.query === "string" ? a.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
      const asked = Number(a.limit);
      const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 200) : 30;
      const all = (await deps.all().catch(() => [])).filter((note) => {
        const text = `${note.name}\n${note.text}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      all.sort(
        (x, y) => (Date.parse(y.modifiedAt ?? "") || 0) - (Date.parse(x.modifiedAt ?? "") || 0),
      );
      return {
        folder: ROOT,
        notes: all.slice(0, limit).map((note) => ({
          path: note.path,
          name: note.name,
          ...(note.size !== undefined ? { size: note.size } : {}),
          ...(note.modifiedAt ? { modifiedAt: note.modifiedAt } : {}),
          firstLine:
            note.text
              .split("\n")
              .find((l) => l.trim() !== "")
              ?.trim()
              .slice(0, 120) ?? "",
          open: openAt(note.path) !== undefined,
        })),
        total: all.length,
        more: all.length > limit,
      };
    },

    "endue.notes.read": async (a) => {
      const path = notePath(a.path);
      const asked = Number(a.maxChars);
      const most = Number.isInteger(asked) && asked > 0 ? Math.min(asked, TEXT.most) : TEXT.usual;
      const open = openAt(path);
      const text = open ? open.text : await disk(path);
      return {
        path,
        text: text.slice(0, most),
        length: text.length,
        truncated: text.length > most,
        open: open !== undefined,
        unsaved: open?.modified === true,
      };
    },

    "endue.notes.new": async (a) => {
      const text = typeof a.text === "string" ? a.text : "";
      const name = nameFor(a.name, deps.now());
      const taken = new Set(
        /** @type {{ entries: Array<{ name: string }> }} */ (
          await bridge.call("fs.list", { path: ROOT, scope: READ }).catch(() => ({ entries: [] }))
        ).entries.map((e) => e.name.toLowerCase()),
      );
      let file = name;
      const [stem, ext] = [name.replace(NOTE, ""), name.slice(name.replace(NOTE, "").length)];
      for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${stem}-${n}${ext}`;
      const path = `${ROOT}/${file}`;
      await write(path, text);
      if (a.open !== false) await deps.commands.run("desk.files.open", { path });
      return { path, length: text.length };
    },

    "endue.notes.append": async (a) => {
      const path = notePath(a.path);
      const added = textOf(a.text);
      writable(path);
      const before = await disk(path).catch((error) => {
        if (/** @type {{ code?: string }} */ (error)?.code === "not_found") return "";
        throw error;
      });
      const joint = before === "" || before.endsWith("\n") ? "" : "\n";
      const text = `${before}${joint}${added}`;
      await write(path, text);
      return { path, length: text.length };
    },

    "endue.notes.replace": async (a) => {
      const path = notePath(a.path);
      const text = textOf(a.text);
      writable(path);
      await write(path, text);
      return { path, length: text.length };
    },
  };
}
