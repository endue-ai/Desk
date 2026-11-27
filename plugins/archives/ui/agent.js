// What an agent reads through Archives (ADR 0088): the entries of the archive on screen, or of
// another one Archives has open, and the text of one entry, bounded. Selection and extraction use
// the same paths as the window.
// An encrypted entry is refused, so a password is never asked of an agent. Archives opens a file
// only through the desk (desk.files.open), so an agent opens one there first.

import { folderOf } from "./files.js";

/**
 * @typedef {import("./formats/archive.js").Entry} Entry
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./archives.js").Held} Held
 */

/** Entries one list answers by default and at most; bytes one read answers by default and at most. */
export const LIST = { usual: 500, most: 5000 };
export const READ = { usual: 65536, most: 262144 };

/** UTF-8 text of bytes, or null when they hold a NUL byte or are not UTF-8. */
const textOf = (/** @type {Uint8Array} */ bytes) => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const cut = new TextDecoder("utf-8").decode(bytes);
    return cut.includes("�") ? null : cut;
  }
};

/**
 * @param {{ on(name: string, handler: (args: unknown) => unknown): unknown }} commands
 * @param {{ open(): Held[], shown(): string | null, show(file: Held, entry: string): Promise<void>,
 *   extract: ReturnType<typeof import("./extract.js").createExtractor>["extract"] }} deps
 */
export function answerAgents(commands, deps) {
  const args = (/** @type {unknown} */ raw) =>
    /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  const archiveOf = (/** @type {Record<string, unknown>} */ a, active = false) => {
    const open = deps.open();
    const asked = typeof a.path === "string" && a.path !== "" ? a.path : undefined;
    const file = asked
      ? open.find((f) => f.path === asked || f.name === asked)
      : open.find((f) => f.buffer === deps.shown());
    if (!file) {
      if (asked)
        throw new Error(`Archives has no ${asked} open; open it with desk.files.open first.`);
      throw new Error("No archive is open in Archives; open one with desk.files.open first.");
    }
    const archive = (active ? file.levels.at(-1) : file.levels[0])?.archive;
    if (!archive) throw new Error(`${file.name} is not an archive Archives reads.`);
    if (archive.refusal) throw new Error(archive.refusal);
    return { file, archive };
  };

  commands.on("endue.archives.show", async (raw) => {
    const a = args(raw);
    const { file, archive } = archiveOf(a, true);
    const entry = archive.entries.find((entry) => entry.path === a.entry);
    if (!entry) throw new Error("Name an entry in the open archive.");
    if (entry.encrypted) throw new Error("Encrypted entries are opened by the person.");
    await deps.show(file, entry.path);
    return { path: file.path, entry: entry.path };
  });

  commands.on("endue.archives.extract", async (raw) => {
    const a = args(raw);
    const { file, archive } = archiveOf(a, a.path === undefined);
    if (typeof a.to !== "string" || !a.to.trim() || !/^(?:~?\/|[a-z]:\/)/iu.test(a.to))
      throw new Error("Name an absolute destination folder.");
    const names = a.entries;
    if (
      names !== undefined &&
      (!Array.isArray(names) ||
        !names.length ||
        names.some(
          (name) =>
            typeof name !== "string" ||
            !archive.entries.some(
              (entry) => entry.path === name || entry.path.startsWith(`${name}/`),
            ),
        ))
    )
      throw new Error("Name entries in the open archive.");
    const selected = /** @type {string[] | undefined} */ (names);
    const chosen = archive.entries.filter(
      (entry) =>
        entry.kind !== "folder" &&
        (!selected ||
          selected.some((name) => entry.path === name || entry.path.startsWith(`${name}/`))),
    );
    if (!chosen.length) throw new Error("Nothing to extract.");
    const result = await deps.extract(archive, chosen, {
      name: file.name,
      beside: folderOf(file.path),
      to: a.to,
    });
    if (!result) throw new Error("Nothing was extracted.");
    return result;
  });

  commands.on("endue.archives.list", (raw) => {
    const a = args(raw);
    const { file, archive } = archiveOf(a);
    const under = typeof a.under === "string" ? a.under.replace(/^\/+|\/+$/g, "") : "";
    const entries = archive.entries.filter(
      (e) => !under || e.path === under || e.path.startsWith(`${under}/`),
    );
    const asked = Number(a.limit);
    const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, LIST.most) : LIST.usual;
    return {
      path: file.path,
      format: archive.format,
      entries: entries.slice(0, limit).map((e) => ({
        path: e.path,
        kind: e.kind,
        size: e.size,
        ...(e.packed !== undefined ? { packed: e.packed } : {}),
        ...(e.date ? { date: e.date.toISOString() } : {}),
        ...(e.encrypted ? { encrypted: true } : {}),
        ...(e.link ? { link: e.link } : {}),
      })),
      total: entries.length,
      more: entries.length > limit,
      details: archive.details,
    };
  });

  commands.on("endue.archives.read", async (raw) => {
    const a = args(raw);
    const { file, archive } = archiveOf(a);
    const name = typeof a.entry === "string" ? a.entry.replace(/^\/+/, "") : "";
    const entry = archive.entries.find((e) => e.path === name);
    if (!entry) throw new Error(`${file.name} holds no ${name || "entry by that name"}.`);
    if (entry.kind !== "file") throw new Error(`${name} is a ${entry.kind}, not a file.`);
    if (entry.encrypted) throw new Error(`${name} is encrypted: the person opens it in Archives.`);
    const asked = Number(a.maxBytes);
    const most = Number.isInteger(asked) && asked > 0 ? Math.min(asked, READ.most) : READ.usual;
    const bytes = await archive.read(entry, most);
    const text = textOf(bytes.subarray(0, most));
    return {
      path: file.path,
      entry: entry.path,
      size: entry.size,
      binary: text === null,
      text,
      truncated: entry.size > Math.min(bytes.length, most),
    };
  });
}
