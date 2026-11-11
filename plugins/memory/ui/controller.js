// The memory inspector's logic: what Eris remembers, through memory.* (ADR 0095), as any plugin with
// memory:read and memory:write would call it. The view and the question (the page's own dialog,
// ask.js) are handed in, so the tests drive it on the SDK's test host without a DOM.
import { emptyText, forgetAllQuestion, forgotText, rows } from "./model.js";

const READ = { permission: "memory:read" };
const WRITE = { permission: "memory:write" };
/** The most entries a page of the list shows. */
export const PAGE = 200;

/**
 * @typedef {import("./model.js").Filter} Filter
 * @typedef {import("./model.js").Row} Row
 * @typedef {{ rows: Row[], filter: Filter, query: string, editing: string | null, empty: string, more: boolean }} Shown
 * @typedef {{ show(shown: Shown): void, status(text: string, lasting?: boolean): void }} View
 * @typedef {{ call(method: string, params: unknown): Promise<any>, onEvent(listener: (event: any) => void): () => void }} Bridge
 */

/**
 * @param {{ bridge: Bridge }} ctx
 * @param {View} view
 * @param {(question: import("./ask.js").Question) => Promise<boolean>} ask  the page's dialog (ask.js)
 */
export function createMemory(ctx, view, ask) {
  const { bridge } = ctx;
  /** @type {Filter} */
  let filter = "all";
  let query = "";
  /** @type {string | null} */
  let editing = null;
  /** @type {Row[]} */
  let shown = [];
  let more = false;
  let generation = 0;

  const kind = () => (filter === "all" ? {} : { kind: filter });

  const draw = () =>
    view.show({ rows: shown, filter, query, editing, empty: emptyText(filter, query), more });

  /** Read the list (or the search) again, dropping answers a later load overtook. */
  const load = async () => {
    const mine = ++generation;
    try {
      let next = [];
      if (query) {
        const { hits } = await bridge.call("memory.search", {
          query,
          ...kind(),
          limit: 100,
          scope: READ,
        });
        const snippets = new Map(hits.map((hit) => [hit.entry.id, hit.snippet]));
        next = rows(
          hits.map((hit) => hit.entry),
          snippets,
        );
        more = false;
      } else {
        const page = await bridge.call("memory.list", { ...kind(), limit: PAGE, scope: READ });
        next = rows(page.entries);
        more = page.next !== undefined;
      }
      if (mine !== generation) return;
      shown = next;
      if (editing && !shown.some((row) => row.id === editing)) editing = null;
      draw();
    } catch (error) {
      if (mine === generation) view.status(`Memory could not be read: ${message(error)}`, true);
    }
  };

  /** Run a write, say how it went, and read the list again. */
  const write = async (method, params, done) => {
    try {
      const answer = await bridge.call(method, { ...params, scope: WRITE });
      view.status(done(answer));
    } catch (error) {
      view.status(`That did not go through: ${message(error)}`, true);
    }
    await load();
  };

  const off = bridge.onEvent((event) => {
    if (event.event === "memory.changed") void load();
  });

  return {
    ready: load(),
    /** Show one kind, or everything. */
    filter(next) {
      filter = next;
      return load();
    },
    /** Show only what matches `words`; empty words show the list again. */
    search(words) {
      query = words.trim();
      return load();
    },
    edit(id) {
      editing = id;
      draw();
    },
    cancel() {
      editing = null;
      draw();
    },
    /** Keep new words for the fact `id`. */
    save(id, text) {
      if (!text.trim()) return Promise.resolve(view.status("A fact needs words."));
      editing = null;
      return write("memory.remember", { id, text: text.trim() }, () => "Saved.");
    },
    /** Keep a new fact in the person's words. */
    add(text) {
      if (!text.trim()) return Promise.resolve();
      return write("memory.remember", { text: text.trim() }, () => "Eris will remember that.");
    },
    forget(id) {
      return write("memory.forget", { id }, (answer) =>
        answer.forgotten ? "Forgotten." : "That was already forgotten.",
      );
    },
    /** Forget every entry of the kind shown, once the person says yes in the page's dialog. */
    async forgetAll() {
      // The kind the question named, whatever the list shows by the time the person answers.
      const asked = filter;
      const params = { all: true, ...kind() };
      if (!(await ask(forgetAllQuestion({ filter, count: shown.length, more, query })))) return;
      await write("memory.forget", params, (answer) => forgotText(asked, answer.forgotten));
    },
    dispose: off,
  };
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
