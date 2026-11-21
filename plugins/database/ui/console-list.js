// What the consoles of a connection are called and kept as (ADR 0286). A console has an id of its
// own, apart from its desk buffer's: its text's key, its history entries' and, after PG-02, its
// session's. A connection's first console takes the connection's id, so the text kept before a
// connection had many consoles is its text; another console takes a random one and the smallest
// number free (`Shop 2`). The surface state keeps the list of consoles the plugin opened itself;
// the ones in a buffer the desk opened for a file (a .sql file, a SQLite database) come back with
// the desk's own files. Pure.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {{ id: string, connection: string, number: number, title?: string, shown?: true }} KeptConsole
 */

const ID = /^[\w-]{1,64}$/u;

/** A file's name, after its last slash. */
export const baseName = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/**
 * What a console is called on screen and in the palette: `Shop`, `Shop 2`, `Shop · Audit`, or a
 * file's `report.sql · Shop`.
 * @param {Pick<Console, "file" | "title" | "number">} console
 * @param {Connection | undefined | null} conn
 */
export function labelOf(console, conn) {
  const on = conn?.name ?? "no connection";
  if (console.file) return `${baseName(console.file.path)} · ${on}`;
  if (console.title) return `${on} · ${console.title}`;
  return (console.number ?? 1) > 1 ? `${on} ${console.number}` : on;
}

/** A console's buffer name. */
export const nameOf = (
  /** @type {Pick<Console, "file" | "title" | "number">} */ console,
  /** @type {Connection | undefined | null} */ conn,
) => `db: ${labelOf(console, conn)}`;

/** Whether a buffer is a console the person types in, bound to no file. */
export const isScratch = (/** @type {Console} */ c) => c.kind === "console" && !c.file;

/** The number a new console of a connection takes: the smallest free from 2. */
export function nextNumber(/** @type {Console[]} */ list, /** @type {string} */ connection) {
  const taken = new Set(
    list.filter((c) => isScratch(c) && c.connection === connection).map((c) => c.number ?? 1),
  );
  let n = 2;
  while (taken.has(n)) n++;
  return n;
}

/** A random id for a console other than a connection's first. */
export function newConsoleId(/** @type {() => number} */ random = Math.random) {
  let out = "";
  while (out.length < 10) out += Math.floor(random() * 36).toString(36);
  return `k-${out}`;
}

/**
 * The consoles the surface state keeps: those the plugin opened, in the order they were opened.
 * @param {Console[]} list
 * @param {Console | null} shown
 * @returns {KeptConsole[]}
 */
export function keptOf(list, shown) {
  return list.flatMap((c) => {
    if (!isScratch(c) || c.visited || !c.consoleId) return [];
    /** @type {KeptConsole} */
    const kept = { id: c.consoleId, connection: c.connection, number: c.number ?? 1 };
    if (c.title) kept.title = c.title;
    if (c === shown) kept.shown = true;
    return [kept];
  });
}

/**
 * The consoles a surface state lists, each once; none when it lists none (an older version's).
 * @param {unknown} saved
 * @returns {KeptConsole[]}
 */
export function readKept(saved) {
  if (!Array.isArray(saved)) return [];
  const seen = new Set();
  return saved.filter((k) => {
    const ok =
      k &&
      typeof k.id === "string" &&
      ID.test(k.id) &&
      typeof k.connection === "string" &&
      Number.isInteger(k.number) &&
      k.number >= 1 &&
      (k.title === undefined || typeof k.title === "string") &&
      !seen.has(k.id);
    if (ok) seen.add(k.id);
    return ok;
  });
}
