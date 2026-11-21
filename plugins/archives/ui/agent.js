// What an agent reads through Archives (ADR 0088): the entries of the archive on screen, or of
// another one Archives has open, and the text of one entry, bounded. It leaves the screen as it is
// and writes nothing: extracting stays the person's, through the palette, where they pick the folder.
// An encrypted entry is refused, so a password is never asked of an agent. Archives opens a file
// only through the desk (desk.files.open), so an agent opens one there first.

/**
 * @typedef {import("./formats/archive.js").Entry} Entry
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {{ buffer: string, path: string, name: string, levels: Array<{ archive?: Archive, format: string }> }} Held
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
 * @param {{ open(): Held[], shown(): string | null }} deps
 */
export function answerAgents(commands, deps) {
  const args = (/** @type {unknown} */ raw) =>
    /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  const archiveOf = (/** @type {Record<string, unknown>} */ a) => {
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
    const archive = file.levels[0]?.archive;
    if (!archive) throw new Error(`${file.name} is not an archive Archives reads.`);
    if (archive.refusal) throw new Error(archive.refusal);
    return { file, archive };
  };

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
