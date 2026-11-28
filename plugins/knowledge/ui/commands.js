// endue.knowledge.* commands. Three are agent tools (ADR 0088), read-only: search, related and
// note, so Claude Code and Codex can ask the desk, over its MCP server, what their own earlier
// sessions did with a file or a ticket. The rest serve the palette and the screen.

import { CONNECTOR, KINDS, NOTES_FOLDER, READ, WRITE } from "./kinds.js";
import { indexNote, noteFor, noteworthy } from "./notes.js";
import { alike, resolve, search, sessionsOf, together } from "./query.js";

/**
 * @typedef {import("./graph.js").Graph} Graph
 * @typedef {(id: string, code: string, message: string) => Error} Fail
 */

/** The commands in plugin.json's order, with the ids the manifest test compares. */
export const COMMAND_IDS = [
  "endue.knowledge.open",
  "endue.knowledge.connect",
  "endue.knowledge.sync",
  "endue.knowledge.search",
  "endue.knowledge.related",
  "endue.knowledge.note",
  "endue.knowledge.focus",
  "endue.knowledge.write-notes",
];

const LIMIT = 20;

/** A session as an agent reads it. */
const sessionOut = (/** @type {import("./graph.js").Session} */ s) => ({
  id: s.id,
  title: s.title,
  agent: s.agent,
  updatedAt: s.updatedAt,
  ...(s.repo ? { repo: s.repo } : {}),
  ...(s.subagent ? { parent: s.parent } : {}),
});

const entityOut = (/** @type {import("./graph.js").Entity} */ e) => ({
  id: e.id,
  kind: e.kind,
  key: e.key,
  label: e.label,
  sessions: e.df,
});

/**
 * Register the handlers and return the actions the screen shares with them.
 * @param {any} ctx
 * @param {{ graph(): Graph, connect(): Promise<void>, sync(): Promise<void>, focus(name: string): string | undefined, mode(m: string): void }} app
 * @param {Fail} [fail]
 */
export function registerCommands(
  ctx,
  app,
  fail = (id, code, message) => Object.assign(new Error(message), { id, code }),
) {
  const args = (/** @type {unknown} */ a) => /** @type {Record<string, any>} */ (a ?? {});
  const known = (/** @type {string} */ command, /** @type {unknown} */ name) => {
    const id = resolve(app.graph(), String(name ?? ""));
    if (!id)
      throw fail(
        command,
        "failed",
        `Nothing in the knowledge base is called ${JSON.stringify(name ?? "")}.`,
      );
    return id;
  };

  /** Write one note, asking once for the folder when the grant is missing. */
  const write = async (/** @type {{ path: string, markdown: string }} */ note) => {
    const params = {
      path: note.path,
      content: note.markdown,
      encoding: "utf8",
      createDirs: true,
      scope: WRITE,
    };
    try {
      await ctx.bridge.call("fs.write", params);
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== "permission_denied") throw error;
      const asked = await ctx.perm.request(
        WRITE,
        `Write knowledge notes to ${NOTES_FOLDER}`,
        "always",
      );
      if (!asked?.granted)
        throw fail("endue.knowledge.write-notes", "cancelled", "Notes need the knowledge folder.");
      await ctx.bridge.call("fs.write", params);
    }
  };

  const helpers = {
    /** Write every noteworthy thing's note and the index; returns how many. */
    async writeNotes() {
      const graph = app.graph();
      const noted = noteworthy(graph);
      for (const entity of noted) {
        const note = noteFor(graph, entity.id);
        if (note) await write(note);
      }
      await write(indexNote(graph, noted));
      return { folder: NOTES_FOLDER, written: noted.length + 1 };
    },
    /** Write the note of `id` and open it in the desk. */
    async openNote(/** @type {string} */ id) {
      const note = noteFor(app.graph(), id);
      if (!note) return;
      await write(note);
      await ctx.commands.run("desk.files.open", { path: note.path });
    },
  };

  ctx.commands.on("endue.knowledge.connect", async () => {
    await app.connect();
    return {};
  });
  ctx.commands.on("endue.knowledge.sync", async () => {
    await app.sync();
    return {};
  });
  ctx.commands.on("endue.knowledge.search", async (/** @type {unknown} */ raw) => {
    const { query, kinds, limit } = args(raw);
    const text = String(query ?? "").trim();
    if (!text) throw fail("endue.knowledge.search", "failed", "Say what to search for.");
    const max = Math.min(50, Math.max(1, Number(limit) || LIMIT));
    const graph = app.graph();
    const found = search(graph, text, { kinds, limit: max });
    const sessions = new Map(found.sessions.map((s) => [s.id, s]));
    if (!kinds?.length || kinds.includes("session")) {
      // What the person asked lives in the bodies: the index searches them in full text.
      const page = await ctx.data
        .query(
          { kinds: ["record"], sources: [CONNECTOR], text: text.slice(0, 500), limit: max },
          { scope: READ },
        )
        .catch(() => ({ items: [] }));
      for (const item of page.items) {
        const s = graph.sessions.get(item.id);
        if (s && sessions.size < max) sessions.set(s.id, s);
      }
    }
    return {
      entities: found.entities.map(entityOut),
      sessions: [...sessions.values()].map(sessionOut),
    };
  });
  ctx.commands.on("endue.knowledge.related", (/** @type {unknown} */ raw) => {
    const { name, limit } = args(raw);
    const id = known("endue.knowledge.related", name);
    const graph = app.graph();
    const max = Math.min(50, Math.max(1, Number(limit) || LIMIT));
    const entity = graph.entities.get(id);
    return {
      id,
      kind: entity ? entity.kind : "session",
      label: entity ? entity.label : graph.sessions.get(id)?.title,
      sessions: sessionsOf(graph, id).slice(0, max).map(sessionOut),
      together: together(graph, id, max).map(({ entity: e, shared }) => ({
        ...entityOut(e),
        shared,
      })),
      ...(entity ? {} : { alike: alike(graph, id, 8).map(({ session }) => sessionOut(session)) }),
    };
  });
  ctx.commands.on("endue.knowledge.note", (/** @type {unknown} */ raw) => {
    const id = known("endue.knowledge.note", args(raw).name);
    const note = noteFor(app.graph(), id);
    if (!note) throw fail("endue.knowledge.note", "failed", `${id} has no note.`);
    return { id, path: note.path, markdown: note.markdown };
  });
  ctx.commands.on("endue.knowledge.focus", (/** @type {unknown} */ raw) => {
    const id = app.focus(String(args(raw).name ?? ""));
    if (!id)
      throw fail(
        "endue.knowledge.focus",
        "failed",
        `Nothing in the knowledge base is called ${JSON.stringify(args(raw).name ?? "")}.`,
      );
    return { id };
  });
  ctx.commands.on("endue.knowledge.write-notes", () => helpers.writeNotes());
  return helpers;
}

/** The kinds an agent may narrow a search to. */
export const SEARCH_KINDS = [...Object.keys(KINDS), "session"];
