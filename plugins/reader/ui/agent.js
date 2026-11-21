// What an agent reads through Reader (ADR 0088): the book on screen, or another one Reader has open,
// as the text of its pages (PDF, XPS, DjVu, comics) or chapters (EPUB, MOBI, FB2), a run of them at a
// time, with its contents; and which pages or chapters hold some words. It leaves the screen and the
// reading place as they are. A book that asks for a password is said so: the person types it, never
// an agent. Reader opens a file only through the desk (desk.files.open), so an agent opens one there.

/**
 * @typedef {import("./open.js").Book} Book
 * @typedef {import("./formats/toc.js").Toc} Toc
 * @typedef {{ buffer: string, path: string, name: string, book: Book }} Open
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
 * @param {{ open(): Open[], shown(): string | null }} deps
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
}
