// The notes plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .save, .revert, desk.buffers.show, .closed) for the notes it holds, reads and writes them with fs.read
// and fs.write, asks with perm.request for a file its grants do not cover, and tells the desk about
// unsaved changes and changes on disk. It only talks to ctx.commands, ctx.bridge and a view, so the
// SDK's test host runs it with a recording view.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {"fs:read" | "fs:write"} FsPermission
 * @typedef {{ buffer: string, path: string, name: string, text: string, modified: boolean }} NoteModel
 * @typedef {{ note(model: NoteModel | null): void, status(text: string): void, focus(): void }} View
 * @typedef {NoteModel & { reported: boolean, watchId?: string }} Note
 */

/**
 * The scope an fs call carries, as the manifest's permissions write it.
 * @template {FsPermission} P
 * @typedef {{ permission: P, paths: string[] }} FsScope
 */

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/** The folder a file is in: notes ask for, and work under, whole folders. */
const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};

/**
 * @template {FsPermission} P
 * @param {P} permission
 * @param {string} path
 * @returns {FsScope<P>}
 */
const scopeOf = (permission, path) => {
  const folder = folderOf(path);
  return { permission, paths: [`${folder}/**`] };
};

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 */
export function createNotes({ bridge, commands }, view) {
  /** Open notes by the buffer the desk named them with. @type {Map<string, Note>} */
  const notes = new Map();
  // Only notes opened by the person enter global search, never arbitrary files or private settings.
  let publishing = Promise.resolve();
  const publish = () => {
    const documents = [...notes.values()].slice(-30).map((note) => ({
      id: note.path,
      title: note.name,
      detail: note.path,
      text: note.text.slice(0, 16384),
      command: "endue.notes.search-open",
      args: { path: note.path },
    }));
    publishing = publishing
      .then(() => bridge.call("search.replace", { documents }))
      .then(
        () => {},
        () => {},
      );
  };
  commands.on("endue.notes.search-open", (args) => {
    const { path } = requested(args);
    if (!path) throw new Error("Choose a note to open");
    const note = [...notes.values()].find((n) => n.path === path);
    if (note) return commands.run("desk.buffers.switch", { id: note.buffer });
    return commands.run("desk.files.open", { path });
  });
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** The buffer on screen. @type {string | null} */
  let shown = null;
  let said = "";

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
    publish();
  };

  /**
   * One fs call. When the grants do not cover the file, ask once for its folder and try again. Every
   * failure is an Error whose message is the sentence the person reads.
   * @template T
   * @template {FsPermission} P
   * @param {P} permission
   * @param {string} path
   * @param {(scope: FsScope<P>) => Promise<T>} call
   * @returns {Promise<T>}
   */
  const withGrant = async (permission, path, call) => {
    const verb = permission === "fs:read" ? "read" : "write";
    const scope = scopeOf(permission, path);
    const refused = new Error(`Not allowed to ${verb} ${path}.`);
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not ${verb} ${path}: ${codeOf(error)}.`);
    try {
      return await call(scope);
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    const reason = verb === "read" ? `To open ${path} in Notes` : `To save ${path}`;
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", { permission: /** @type {Permission} */ (scope), reason })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return await call(scope);
    } catch (error) {
      throw failed(error);
    }
  };

  /** @param {string} path */
  const read = async (path) => {
    const { content } = await withGrant("fs:read", path, (scope) =>
      bridge.call("fs.read", { path, encoding: "utf8", scope }),
    );
    return content;
  };

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
   * the same words, which the desk shows in its own notice; a success clears the status line.
   * @param {string} name
   * @param {(args: unknown) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        await handler(args);
        say("");
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const text = await read(path);
    forget(buffer);
    /** @type {Note} */
    const note = { buffer, path, name: nameOf(path), text, modified: false, reported: false };
    notes.set(buffer, note);
    publish();
    present(buffer);
    await watch(note);
  });

  answer("desk.files.save", async (args) => {
    const { buffer, path: asked } = requested(args);
    const note = held(buffer);
    const path = asked ?? note.path;
    const content = note.text;
    await withGrant("fs:write", path, (scope) =>
      bridge.call("fs.write", { path, content, encoding: "utf8", scope }),
    );
    // desk.files clears the list's mark after a save; text typed while it was written stays unsaved,
    // and the desk hears so once this answer has reached it.
    note.reported = false;
    note.modified = note.text !== content;
    if (shown === buffer) render();
    if (note.modified) setTimeout(() => report(note), 0);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const note = held(buffer);
    note.text = await read(asked ?? note.path);
    publish();
    note.modified = false;
    note.reported = false;
    if (shown === buffer) render();
  });

  answer("desk.buffers.show", (args) => {
    const { buffer } = requested(args);
    held(buffer);
    present(buffer);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    held(buffer);
    forget(buffer);
    if (shown !== buffer) return;
    // The desk shows the buffer used before this one itself, with desk.buffers.show.
    shown = null;
    render();
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const note = buffer === undefined ? undefined : notes.get(buffer);
    if (!note) return;
    // Every change, the one a save causes included: desk.files.on-change decides what happens.
    commands.run("desk.files.changed", { path: note.path }).catch(() => {});
  });

  render();

  /** The person typed in the note on screen. */
  const edit = (/** @type {string} */ text) => {
    const note = shown === null ? undefined : notes.get(shown);
    if (!note || note.text === text) return;
    note.text = text;
    if (!note.modified) {
      note.modified = true;
      render();
    }
    report(note);
    publish();
  };

  return { edit };
}
