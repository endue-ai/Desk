// What an agent reads through Reader (ADR 0088): the book on screen, or another one Reader has open,
// as the text of its pages (PDF, XPS, DjVu, comics) or chapters (EPUB, MOBI, FB2), a run of them at a
// time, with its contents; and which pages or chapters hold some words. It leaves the screen and the
// reading place as they are. A book that asks for a password is said so: the person types it, never
// an agent. Reader opens a file only through the desk (desk.files.open), so an agent opens one there.

/**
 * @typedef {import("./open.js").Book} Book
 * @typedef {import("./formats/toc.js").Toc} Toc
 * @typedef {import("./reader.js").Open} Open
 * @typedef {import("./marks.js").At} At
 */

/** Units one read answers by default and at most, and the characters it holds at most. */
export const UNITS = { usual: 5, most: 50 };
export const CHARS = 100000;
/** Matches one find answers at most. */
const FOUND = 50;

/** The contents, flattened with their depth. */
const contentsOf = (/** @type {Toc[]} */ toc, depth = 0) =>
  toc.flatMap(
    /** @returns {Array<{ title: string, at: number, depth: number }>} */
    (t) => [{ title: t.title, at: t.unit + 1, depth }, ...contentsOf(t.children ?? [], depth + 1)],
  );

/**
 * @param {{ on(name: string, handler: (args: unknown) => unknown): unknown }} commands
 * @param {{ open(): Open[], shown(): string | null,
 *   go?: (at: At) => Promise<unknown>, zoom?: (level: number | "fit") => number,
 *   marking: ReturnType<typeof import("./marking.js").createMarking> }} deps
 */
export function answerAgents(commands, deps) {
  /** The book a call names, or the one on screen, and every open one. */
  const bookOf = (/** @type {Record<string, unknown>} */ a) => {
    const open = deps.open();
    const books = open.map((f) => ({
      path: f.path,
      name: f.name,
      onScreen: f.buffer === deps.shown(),
    }));
    const asked = typeof a.path === "string" && a.path !== "" ? a.path : undefined;
    const file = asked
      ? open.find((f) => f.path === asked || f.name === asked)
      : open.find((f) => f.buffer === deps.shown());
    if (!file) {
      if (asked)
        throw new Error(`Reader has no ${asked} open; open it with desk.files.open first.`);
      throw new Error("No book is open in Reader; open one with desk.files.open first.");
    }
    const { book } = file;
    if (book.kind === "password")
      throw new Error(`${file.name} is locked: the person types its password in Reader.`);
    if (book.kind === "details")
      throw new Error(`Reader shows only details of ${file.name}: ${book.why}`);
    const units = book.kind === "pages" ? book.pages.length : book.chapters.length;
    const unit = book.kind === "pages" ? "page" : "chapter";
    return { file, book, books, units, unit };
  };
  const args = (/** @type {unknown} */ raw) =>
    /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});

  commands.on("endue.reader.read", async (raw) => {
    const a = args(raw);
    const { file, book, books, units, unit } = bookOf(a);
    const from = Number.isInteger(a.from) && Number(a.from) >= 1 ? Number(a.from) : 1;
    const asked = Number(a.count);
    const count = Number.isInteger(asked) && asked > 0 ? Math.min(asked, UNITS.most) : UNITS.usual;
    /** @type {Array<{ at: number, title?: string, text: string }>} */
    const read = [];
    let chars = 0;
    for (let i = from - 1; i < Math.min(units, from - 1 + count) && chars < CHARS; i++) {
      const text = (await book.text(i)).slice(0, CHARS - chars);
      chars += text.length;
      const title = book.kind === "chapters" ? book.chapters[i]?.title : undefined;
      read.push({ at: i + 1, ...(title ? { title } : {}), text });
    }
    const last = read.at(-1)?.at ?? from - 1;
    return {
      path: file.path,
      title: book.title || file.name,
      format: book.format,
      unit,
      units,
      at: file.at.unit + 1,
      books,
      ...(from === 1 ? { contents: contentsOf(book.toc).slice(0, 200) } : {}),
      [unit === "page" ? "pages" : "chapters"]: read,
      more: last < units,
    };
  });

  commands.on("endue.reader.find", async (raw) => {
    const a = args(raw);
    const query = typeof a.query === "string" ? a.query.trim().toLocaleLowerCase() : "";
    if (!query) throw new Error("Say which words to find: query is empty.");
    const { file, book, units, unit } = bookOf(a);
    /** @type {Array<{ at: number, snippet: string }>} */
    const found = [];
    for (let i = 0; i < units && found.length < FOUND; i++) {
      const text = await book.text(i);
      const at = text.toLocaleLowerCase().indexOf(query);
      if (at < 0) continue;
      const snippet = text
        .slice(Math.max(0, at - 60), at + query.length + 60)
        .replace(/\s+/g, " ")
        .trim();
      found.push({ at: i + 1, snippet });
    }
    return { path: file.path, query, unit, found, more: found.length >= FOUND };
  });

  const place = (/** @type {unknown} */ at, /** @type {number} */ units) => {
    if (typeof at !== "number" || !Number.isSafeInteger(at) || at < 1 || at > units)
      throw new Error("That page or chapter is outside the open book.");
    return { unit: at - 1, offset: 0 };
  };
  commands.on("endue.reader.go", async (raw) => {
    const { file, units } = bookOf({});
    if (!deps.go) throw new Error("Reader has no page to move.");
    await deps.go(place(args(raw).at, units));
    if (file.buffer !== deps.shown()) throw new Error("The book changed.");
    return { path: file.path, at: file.at.unit + 1 };
  });
  commands.on("endue.reader.zoom", (raw) => {
    const { file } = bookOf({});
    const { level } = args(raw);
    if (level !== "fit" && (typeof level !== "number" || !(level >= 0.25 && level <= 5)))
      throw new Error("Zoom needs fit or a level from 0.25 to 5.");
    if (!deps.zoom) throw new Error("Reader has no page to zoom.");
    return { path: file.path, zoom: deps.zoom(level) };
  });
  commands.on("endue.reader.marks", () => {
    const { file } = bookOf({});
    return {
      path: file.path,
      bookmarks: file.bookmarks.map(({ unit, ...mark }) => ({ at: unit + 1, ...mark })),
      notes: file.notes.map(({ unit, ...note }) => ({ at: unit + 1, ...note })),
    };
  });
  commands.on("endue.reader.bookmark", async (raw) => {
    const { file, units } = bookOf({});
    const { at, label } = args(raw);
    if (typeof label !== "string" || !label.trim()) throw new Error("Give the bookmark a label.");
    const where = at === undefined ? file.at : place(at, units);
    if (!(await deps.marking.bookmark(where, label.trim())))
      throw new Error("Reader could not keep the bookmark.");
    return { path: file.path, at: where.unit + 1, label: label.trim() };
  });
  commands.on("endue.reader.note", async (raw) => {
    const { file, units } = bookOf({});
    const { at, text } = args(raw);
    const where = place(at, units);
    if (typeof text !== "string" || !text.trim()) throw new Error("Give the note some text.");
    if (!(await deps.marking.note(where, text))) throw new Error("Reader could not keep the note.");
    return { path: file.path, at: where.unit + 1 };
  });
}
