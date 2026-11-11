// The notes plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .save, .revert, desk.buffers.show, .closed) for the notes it holds, reads and writes them with fs.read
// and fs.write, asks with perm.request for a file its grants do not cover, and tells the desk about
// unsaved changes and changes on disk. It only talks to ctx.commands, ctx.bridge and a view, so the
// SDK's test host runs it with a recording view. A note the desk lists and the frame lost (it slept,
// or its page loaded again) opens again from what the sleep kept (keep.js), or from disk.

import { createDrops } from "./drops.js";
import { createGrants, scopeOf } from "./grants.js";
import { keptText, openFiles, readEdit, readPlace } from "./keep.js";
import { createLibrary } from "./library.js";
import { createSearch } from "./search.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./keep.js").Place} Place
 * @typedef {import("./keep.js").KeptPlace} KeptPlace
 * @typedef {import("./keep.js").KeepSdk} KeepSdk
 * @typedef {{ buffer: string, path: string, name: string, text: string, modified: boolean }} NoteModel
 * @typedef {{ note(model: NoteModel | null): void, status(text: string): void, focus(): void, where(): Place, place(at: Place): void } & import("./drops.js").DropView} View
 * @typedef {NoteModel & { reported: boolean, saved?: string, watchId?: string }} Note
 * @typedef {Pick<PluginContext, "bridge" | "commands"> & { surface: Pick<PluginContext["surface"], "onUnload" | "restored">, dnd?: PluginContext["dnd"] }} NotesContext
 */

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/**
 * @param {NotesContext} ctx
 * @param {View} view
 * @param {KeepSdk} sdk the SDK's keepFiles and text changes, which main.js imports
 */
export function createNotes({ bridge, commands, surface, dnd }, view, sdk) {
  /** Open notes by the buffer the desk named them with. @type {Map<string, Note>} */
  const notes = new Map();
  const { publish, publishAfterTyping, published } = createSearch({ bridge, commands }, () => [
    ...notes.values(),
  ]);
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** The buffer on screen. @type {string | null} */
  let shown = null;
  let said = "";
  /** What a success leaves on the status line until the person types: unsaved text not kept. */
  let notice = "";

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };

  /** What the view shows: the note on screen, or null for "No note open". */
  const render = () => {
    const note = shown === null ? undefined : notes.get(shown);
    if (!note) return view.note(null);
    const { buffer, path, name, text, modified } = note;
    view.note({ buffer, path, name, text, modified });
  };
  const present = (/** @type {string} */ buffer) => {
    shown = buffer;
    render();
    view.focus();
  };

  const held = (/** @type {string} */ buffer) => {
    const note = notes.get(buffer);
    if (!note) throw new Error(`No note ${buffer}.`);
    return note;
  };

  const forget = (/** @type {string} */ buffer) => {
    const note = notes.get(buffer);
    if (note?.watchId) watches.delete(note.watchId);
    notes.delete(buffer);
  };

  // Put to sleep while nobody sees it, notes keeps its notes and comes back from them (ADR 0070).
  const kept = sdk.keepFiles(surface, {
    files: () => openFiles([...notes.values()], shown, view.where(), sdk.textChange),
    shown: () => shown,
    readPlace,
    readEdit: readEdit(sdk.isTextChange),
  });
  /** Buffers this frame closed: a show of one does not open it again. @type {Set<string>} */
  const closed = new Set();
  const { withGrant, read, quietly } = createGrants(bridge);

  /** Follow the file on disk. Without a watch the note still works; changes just go unnoticed. */
  const watch = async (/** @type {Note} */ note) => {
    const { path } = note;
    await bridge.call("fs.watch", { path, scope: scopeOf("fs:read", path) }).then(
      ({ watchId }) => {
        if (notes.get(note.buffer) !== note) return;
        note.watchId = watchId;
        watches.set(watchId, note.buffer);
      },
      () => {},
    );
  };

  /** desk.buffers.update runs once per change from saved to unsaved, not on every keystroke. */
  const report = (/** @type {Note} */ note) => {
    if (!note.modified || note.reported || notes.get(note.buffer) !== note) return;
    note.reported = true;
    commands.run("desk.buffers.update", { id: note.buffer, modified: true }).catch(() => {});
  };

  /**
   * Answer one of the desk's requests. A failure goes to the status line and ends the request with
   * the same words, which the desk shows in its own notice; a success clears the status line, but
   * for a notice about unsaved text a sleep could not keep.
   * @param {string} name
   * @param {(args: unknown) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        await handler(args);
        say(notice);
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  /**
   * Reads of visits on their way, by buffer: a show that comes first waits for its note.
   * @type {Map<string, Promise<string>>}
   */
  const visiting = new Map();

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const reading = read(path);
    visiting.set(buffer, reading);
    /** @type {string} */
    let text;
    try {
      text = await reading;
    } finally {
      if (visiting.get(buffer) === reading) visiting.delete(buffer);
    }
    forget(buffer);
    kept.take(buffer);
    closed.delete(buffer);
    /** @type {Note} */
    const note = {
      buffer,
      path,
      name: nameOf(path),
      text,
      saved: text,
      modified: false,
      reported: false,
    };
    notes.set(buffer, note);
    publish();
    present(buffer);
    await watch(note);
  });

  answer("desk.files.save", async (args) => {
    const { buffer, path: asked } = requested(args);
    const note = await holding(buffer);
    const path = asked ?? note.path;
    const content = note.text;
    await withGrant("fs:write", path, (scope) =>
      bridge.call("fs.write", { path, content, encoding: "utf8", scope }),
    );
    // desk.files clears the list's mark after a save; text typed while it was written stays unsaved,
    // and the desk hears so once this answer has reached it.
    note.reported = false;
    if (path === note.path) note.saved = content;
    note.modified = note.text !== content;
    if (shown === buffer) render();
    if (note.modified) setTimeout(() => report(note), 0);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const note = await holding(buffer);
    note.text = await read(asked ?? note.path);
    if (!asked || asked === note.path) note.saved = note.text;
    publish();
    note.modified = false;
    note.reported = false;
    if (shown === buffer) render();
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer, path } = requested(args);
    // The desk lists a buffer as its visit starts; one still waiting for a permission prompt shows
    // once it is read, and a visit that failed says so itself.
    const visit = visiting.get(buffer);
    const visited = visit
      ? await visit.then(
          () => true,
          () => false,
        )
      : true;
    // One the desk lists that this frame lost, and did not close itself, opens again.
    const from = path ?? kept.files().find((file) => file.buffer === buffer)?.path;
    if (visited && from && !notes.has(buffer) && !closed.has(buffer))
      await reopen(buffer, from, true);
    held(buffer);
    present(buffer);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    closed.add(buffer);
    if (kept.take(buffer) && !notes.has(buffer)) return;
    held(buffer);
    forget(buffer);
    publish();
    if (shown !== buffer) return;
    // The desk shows the buffer used before this one itself, with desk.buffers.show.
    shown = null;
    render();
  });

  // ~/Notes on disk: a new dated note, opened as any file is, and the palette's Notes group.
  const library = createLibrary({ bridge });
  answer("endue.notes.new", async () => {
    const path = await library.fresh(new Date());
    const content = "";
    await withGrant(
      "fs:write",
      path,
      (scope) =>
        bridge.call("fs.write", { path, content, encoding: "utf8", createDirs: true, scope }),
      `To make the new note ${path}`,
    );
    await commands.run("desk.files.open", { path });
  });
  commands.on("endue.notes.find", (args) =>
    library.find(args, new Set(published().map((note) => note.path))),
  );

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const note = buffer === undefined ? undefined : notes.get(buffer);
    if (!note) return;
    // Every change, the one a save causes included: desk.files.on-change decides what happens.
    commands.run("desk.files.changed", { path: note.path }).catch(() => {});
  });

  render();

  /**
   * Open again a note the desk lists and this frame does not hold: from what the last sleep kept,
   * else from disk. `ask` (the person wants it now) may ask for its folder; without it a note that
   * cannot be read stays kept. Resolves with its kept place, or undefined when it did not open.
   * @returns {Promise<KeptPlace | undefined>}
   */
  const reopen = async (
    /** @type {string} */ buffer,
    /** @type {string} */ path,
    /** @type {boolean} */ ask,
  ) => {
    const found = kept.files().find((file) => file.buffer === buffer);
    const file = found ?? { buffer, path };
    const whole = file.edit !== undefined && "text" in file.edit;
    const disk = ask && !whole ? await read(file.path) : await quietly(file.path);
    const back = keptText(file, disk, sdk.applyTextChange);
    if (!back || notes.has(buffer)) return undefined;
    kept.take(buffer);
    const { text, saved, modified, reported, lost } = back;
    const name = nameOf(file.path);
    /** @type {Note} */
    const note = { buffer, path: file.path, name, text, modified, reported };
    if (saved !== undefined) note.saved = saved;
    notes.set(buffer, note);
    publish();
    const watchId = file.place?.watchId;
    if (watchId) {
      note.watchId = watchId;
      watches.set(watchId, buffer);
    } else void watch(note);
    if (lost || !found) {
      // What the desk marks unsaved is not here any more: the note is as it is on disk.
      commands.run("desk.buffers.update", { id: buffer, modified: false }).catch(() => {});
      notice = lost
        ? `The unsaved changes to ${name} could not be kept while its window slept.`
        : `${name} was opened again from disk.`;
      say(notice);
    }
    return file.place ?? {};
  };
  /** The note of `buffer`, opened again first when the last sleep kept it. */
  const holding = async (/** @type {string} */ buffer) => {
    const file = notes.has(buffer) ? undefined : kept.files().find((f) => f.buffer === buffer);
    if (file) await reopen(buffer, file.path, true);
    return held(buffer);
  };

  /** Back from a sleep: the kept notes open again, without asking or taking the focus. */
  const restore = async () => {
    /** @type {KeptPlace | undefined} */
    let at;
    for (const file of kept.files()) {
      const place = await reopen(file.buffer, file.path, false);
      if (file.buffer === kept.shown) at = place;
    }
    publish();
    if (kept.shown === null || !notes.has(kept.shown)) return;
    shown = kept.shown;
    render();
    const [start = 0, end = 0] = at?.caret ?? [];
    view.place({ start, end, scroll: at?.scroll ?? 0 });
  };
  const ready = restore();

  /** The person typed in the note on screen. */
  const edit = (/** @type {string} */ text) => {
    const note = shown === null ? undefined : notes.get(shown);
    if (!note || note.text === text) return;
    note.text = text;
    if (notice) {
      notice = "";
      say("");
    }
    if (!note.modified) {
      note.modified = true;
      render();
    }
    report(note);
    publishAfterTyping();
  };

  // Paths dropped on the note become links and text goes in at the caret; with none open, they open.
  createDrops({ commands, dnd }, view, {
    shown: () => (shown === null ? undefined : notes.get(shown)),
    say,
  });

  return { edit, ready };
}
