// The consoles of the connections (ADR 0286): as many as the person opens, each a desk buffer with
// an id of its own (console-list.js), its text kept under it (console-text.js); the one used last
// of a connection, else its first; a new one numbered; renamed, closed (a closed console's text
// forgotten, but for a connection's first console, whose text stays as the one console's did); a
// .sql file's console in the desk's buffer for the file (console-files.js); and the list the
// surface state keeps, opened again after a restart. No DOM.

import {
  baseName,
  isScratch,
  keptOf,
  labelOf,
  nameOf,
  newConsoleId,
  nextNumber,
  readKept,
} from "./console-list.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./consoles.js").SqlFile} SqlFile
 * @typedef {{
 *   commands: { run(id: string, args?: unknown): Promise<unknown> },
 *   connection(id: string): Connection | undefined,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   cancelled(message: string): Error,
 *   choose?(title: string): Promise<Connection | undefined>,
 *   bound?(target: Console, conn: Connection): Promise<void> | void,
 *   random?(): number,
 * }} Deps
 *   `choose` asks for a connection; `bound` hears a .sql file's console given one (the file
 *   remembers it).
 */

/**
 * @param {ReturnType<typeof import("./buffers.js").createBuffers>} buffers
 * @param {ReturnType<typeof import("./console-text.js").createTexts>} texts
 * @param {Deps} deps
 */
export function createMany(buffers, texts, deps) {
  const random = deps.random ?? Math.random;
  const scratchOf = (/** @type {string} */ connection) =>
    buffers.list().filter((c) => isScratch(c) && c.connection === connection);

  /** A console of `conn` with its kept text, in the buffer given or a new one of the plugin's. */
  const make = async (
    /** @type {Connection} */ conn,
    /** @type {{ number: number, consoleId: string, title?: string, buffer?: string }} */ how,
  ) => {
    const fields = {
      kind: "console",
      connection: conn.id,
      consoleId: how.consoleId,
      number: how.number,
      ...(how.title ? { title: how.title } : {}),
      ...(how.buffer ? { visited: true } : {}),
    };
    const name = nameOf(fields, conn);
    const id = how.buffer ?? (await buffers.open(name));
    const text = await texts.load(how.consoleId);
    return buffers.made({ id, name, text, ...fields });
  };
  /** The id and number the next console of `conn` takes: its first's while that is closed. */
  const slot = (/** @type {Connection} */ conn) =>
    scratchOf(conn.id).some((c) => c.consoleId === conn.id)
      ? { consoleId: newConsoleId(random), number: nextNumber(buffers.list(), conn.id) }
      : { consoleId: conn.id, number: 1 };

  /** The console on screen, or the one named, that the person may close or rename. */
  const pickConsole = (/** @type {string | undefined} */ id) => {
    const target = id ? buffers.get(id) : buffers.current();
    if (target?.kind !== "console") throw new Error("No console is on screen.");
    return target;
  };

  /** A console that closed: an extra one's text goes with it. */
  const gone = (/** @type {Console} */ target) => {
    if (isScratch(target) && target.consoleId && target.consoleId !== target.connection)
      texts.forget(target.consoleId);
    else texts.keep();
  };

  return {
    /** Show the connection's console used last, else open its first. */
    async open(/** @type {Connection} */ conn) {
      const [last] = scratchOf(conn.id).sort((a, b) => (b.used ?? 0) - (a.used ?? 0));
      if (last) return buffers.show(last);
      return buffers.show(await make(conn, { consoleId: conn.id, number: 1 }));
    },
    /** Open another console on a connection, `<connection> 2` and on. */
    async openNew(/** @type {Connection} */ conn) {
      const how = { consoleId: newConsoleId(random), number: nextNumber(buffers.list(), conn.id) };
      return buffers.show(await make(conn, how));
    },
    /** A console in a buffer the desk opened (a SQLite file it visits). */
    async openIn(/** @type {Connection} */ conn, /** @type {string} */ buffer) {
      const found = buffers.get(buffer);
      if (found) return buffers.show(found);
      return buffers.show(await make(conn, { ...slot(conn), buffer }));
    },
    /**
     * A .sql file's console in its buffer, on a connection or none yet.
     * @param {{ buffer: string, conn: Connection | undefined, text: string, file: SqlFile }} fields
     */
    openFile({ buffer, conn, text, file }) {
      const found = buffers.get(buffer);
      if (found?.file) return buffers.show(found);
      const fields = { file, connection: conn?.id ?? "", consoleId: newConsoleId(random) };
      const name = nameOf(fields, conn);
      return buffers.show(
        buffers.made({ id: buffer, kind: "console", name, text, visited: true, ...fields }),
      );
    },
    /** Close a console (the one on screen unless named), asking first for unsaved edits. */
    async close(/** @type {string | undefined} */ id) {
      const target = pickConsole(id);
      if (target.running) throw new Error("A run is going on in this console: cancel it first.");
      const label = labelOf(target, deps.connection(target.connection));
      if (target.file?.modified) {
        const name = baseName(target.file.path);
        const ok = await deps.confirm(`Close ${name} without saving?`, ["Its edits are lost."]);
        if (!ok) throw deps.cancelled("Not closed.");
      }
      buffers.closed(target.id);
      gone(target);
      await deps.commands.run("desk.buffers.close", { id: target.id }).catch(() => {});
      return label;
    },
    /** The desk closed one of the plugin's buffers. */
    closed(/** @type {string} */ id) {
      const target = buffers.get(id);
      buffers.closed(id);
      if (target) gone(target);
    },
    /** Name the console on screen (an empty name gives it its connection's again). */
    async rename(/** @type {string} */ name) {
      const target = pickConsole(undefined);
      if (target.file) throw new Error("A .sql file's console is named after its file.");
      const title = name.trim().slice(0, 60);
      if (title) target.title = title;
      else delete target.title;
      target.name = nameOf(target, deps.connection(target.connection));
      if (!target.visited)
        await deps.commands
          .run("desk.buffers.update", { id: target.id, name: target.name })
          .catch(() => {});
      buffers.render();
      return labelOf(target, deps.connection(target.connection));
    },
    /** Before a run: a .sql file's console without a connection asks for one. */
    async ready() {
      const shown = buffers.current();
      if (!shown?.file || deps.connection(shown.connection) || !deps.choose) return;
      const conn = await deps.choose(
        `Database: run ${baseName(shown.file.path)} on which connection?`,
      );
      if (!conn) throw deps.cancelled("Not run: pick the connection it runs on.");
      await this.bind(shown, conn);
    },
    /** Run a .sql file's console on another connection. */
    async bind(/** @type {Console} */ target, /** @type {Connection} */ conn) {
      target.connection = conn.id;
      target.name = nameOf(target, conn);
      await deps.bound?.(target, conn);
      buffers.render();
    },
    /** Every console, in the order they were opened. */
    list: () => buffers.list().filter((c) => c.kind === "console"),
    /** A console by its buffer's id, its own id or what it is called. */
    find(/** @type {string} */ ref) {
      return buffers
        .list()
        .find(
          (c) =>
            c.kind === "console" &&
            (c.id === ref ||
              c.consoleId === ref ||
              labelOf(c, deps.connection(c.connection)) === ref),
        );
    },
    /** The consoles the surface state keeps. */
    kept: () => keptOf(buffers.list(), buffers.current()),
    /** Open the consoles kept before a restart, in their order, the one on screen shown; false
     * when none was kept. */
    async restore(/** @type {unknown} */ saved) {
      /** @type {Console[]} */
      const back = [];
      let shown;
      for (const k of readKept(saved)) {
        const conn = deps.connection(k.connection);
        if (!conn || buffers.find((c) => c.consoleId === k.id)) continue;
        const how = { consoleId: k.id, number: k.number, ...(k.title ? { title: k.title } : {}) };
        const target = buffers.add(await make(conn, how));
        back.push(target);
        if (k.shown) shown = target;
      }
      const last = shown ?? back.at(-1);
      if (last) buffers.show(last);
      return back.length > 0;
    },
    /** A connection was renamed: so are its consoles. */
    async renamed(/** @type {Connection} */ conn) {
      for (const target of buffers.list()) {
        if (target.connection !== conn.id || target.kind !== "console") continue;
        target.name = nameOf(target, conn);
        if (target.visited) continue;
        await deps.commands
          .run("desk.buffers.update", { id: target.id, name: target.name })
          .catch(() => {});
      }
    },
  };
}
