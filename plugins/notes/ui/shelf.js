// The shelf beside the note: every note in ~/Notes, newest first, narrowed by a filter, with New,
// and for the note on screen auto-save, rename and delete. It talks to the desk only through
// commands and the bridge, and to the notes controller (notes.js) through its save and current.
// Opening a note runs desk.files.open from Notes itself, so the note opens in this window (ADR 0212).

import { ROOT } from "./library.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {{ path: string, name: string, title: string, modifiedAt?: string }} Shelved
 * @typedef {{ list(items: Shelved[], current: string | undefined, filter: string): void, confirming(on: boolean): void }} ShelfView
 * @typedef {{ save(buffer: string): Promise<unknown>, current(): { buffer: string, path: string, name: string, modified: boolean } | undefined, grants: ReturnType<typeof import("./grants.js").createGrants>, say(text: string): void }} NotesApp
 * @typedef {{ notes(): Promise<Shelved[]> }} Library
 */

/** How long typing pauses before a note in ~/Notes saves itself. */
export const AUTOSAVE_MS = 800;
/** How long Delete waits for its confirmation. */
const CONFIRM_MS = 4000;
/** Changes on disk that come together refresh the shelf once. */
const REFRESH_MS = 250;

const READ = { permission: "fs:read", paths: [`${ROOT}/**`] };

/** Notes in ~/Notes save themselves; any other file waits for Save (Mod+S). */
export const autosaves = (/** @type {string} */ path) => path.startsWith(`${ROOT}/`);

const folderOf = (/** @type {string} */ path) => path.slice(0, path.lastIndexOf("/"));

/**
 * A file name for a typed one: trimmed, without slashes, `.md` added unless it ends in .md or .txt.
 * Empty for a name that cannot be a file.
 */
export const fileNameOf = (/** @type {string} */ typed) => {
  const name = typed.trim().replace(/[/\\:]/g, "-");
  if (name === "" || name === "." || name === "..") return "";
  return /\.(md|txt)$/i.test(name) ? name : `${name}.md`;
};

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {NotesApp} app
 * @param {Library} library
 * @param {ShelfView} view
 * @param {{ timers?: { set: typeof setTimeout, clear: typeof clearTimeout } }} [options]
 */
export function createShelf({ bridge, commands }, app, library, view, options = {}) {
  const set = options.timers?.set ?? setTimeout;
  const clear = options.timers?.clear ?? clearTimeout;
  /** @type {Shelved[]} */
  let items = [];
  let filter = "";
  /** @type {string | undefined} */
  let watchId;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saving;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let refreshing;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let confirm;

  const draw = () => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((item) => {
      const hay = `${item.name} ${item.title}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    });
    view.list(shown, app.current()?.path, filter);
  };

  /** Follow ~/Notes, once it is there: a note made, changed or gone elsewhere shows here too. */
  const follow = async () => {
    if (watchId) return;
    await bridge.call("fs.watch", { path: ROOT, recursive: true, scope: READ }).then(
      (answer) => {
        watchId = answer.watchId;
      },
      () => {},
    );
  };

  const refresh = async () => {
    items = await library.notes();
    draw();
    if (items.length > 0) await follow();
  };
  const later = () => {
    clear(refreshing);
    refreshing = set(() => void refresh(), REFRESH_MS);
  };

  bridge.onEvent((event) => {
    if (event.event === "fs.changed" && event.data.watchId === watchId) later();
  });

  /** Run a command; a failure goes to the status line in its own words. */
  const attempt = async (/** @type {() => Promise<unknown>} */ work) => {
    try {
      await work();
    } catch (error) {
      app.say(error instanceof Error ? error.message : String(error));
    }
  };

  /** Write the note on screen now, when it has unsaved text. */
  const flush = async () => {
    clear(saving);
    saving = undefined;
    const note = app.current();
    if (note?.modified) await app.save(note.buffer);
  };

  return {
    refresh,
    /** The person typed in the note on screen: a note in ~/Notes saves once the keys pause. */
    typed() {
      const note = app.current();
      if (!note || !autosaves(note.path)) return;
      clear(saving);
      saving = set(() => {
        saving = undefined;
        void attempt(async () => {
          await flush();
          later();
        });
      }, AUTOSAVE_MS);
    },
    /** The note on screen changed: the shelf marks it. */
    shown: draw,
    filter(/** @type {string} */ text) {
      filter = text;
      draw();
    },
    open: (/** @type {string} */ path) =>
      attempt(async () => {
        await flush();
        await commands.run("desk.files.open", { path });
      }),
    create: () =>
      attempt(async () => {
        await flush();
        await commands.run("endue.notes.new", {});
        await refresh();
      }),
    /** Give the note on screen a new file name in its folder; it stays open under that name. */
    rename: (/** @type {string} */ typed) =>
      attempt(async () => {
        const note = app.current();
        if (!note) return;
        const name = fileNameOf(typed);
        if (!name) throw new Error("A note's name cannot be empty.");
        const to = `${folderOf(note.path)}/${name}`;
        if (to === note.path) return;
        await flush();
        const from = note.path;
        await app.grants.withGrant(
          "fs:write",
          to,
          (scope) => bridge.call("fs.rename", { from, to, scope }),
          `To rename ${from} to ${name}`,
        );
        // The new name opens in this window first, so closing the old one leaves the window.
        await commands.run("desk.files.open", { path: to });
        await commands.run("desk.buffers.close", { id: note.buffer });
        await refresh();
      }),
    /** Delete asks once more on the same button; the second press moves the note to the Trash. */
    remove: () =>
      attempt(async () => {
        const note = app.current();
        if (!note) return;
        if (confirm === undefined) {
          view.confirming(true);
          confirm = set(() => {
            confirm = undefined;
            view.confirming(false);
          }, CONFIRM_MS);
          return;
        }
        clear(confirm);
        confirm = undefined;
        view.confirming(false);
        clear(saving);
        saving = undefined;
        await app.grants.withGrant(
          "fs:write",
          note.path,
          (scope) => bridge.call("fs.trash", { path: note.path, scope }),
          `To move ${note.path} to the Trash`,
        );
        await commands.run("desk.buffers.update", { id: note.buffer, modified: false });
        await commands.run("desk.buffers.close", { id: note.buffer });
        app.say(`${note.name} was moved to the Trash.`);
        await refresh();
      }),
    flush,
  };
}
