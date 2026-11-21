// The notes plugin: Markdown and text files in one plain text area, beside a shelf of the notes in
// ~/Notes. It uses only the public SDK and bridge API, exactly as a community plugin would.
import {
  applyTextChange,
  defineUiPlugin,
  isTextChange,
  keepFiles,
  startWorker,
  textChange,
} from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { createCounter } from "./counter.js";
import { createLibrary } from "./library.js";
import { createNotes } from "./notes.js";
import { createShelf } from "./shelf.js";
import { createShelfView } from "./shelf-view.js";
import { createView } from "./view.js";

defineElements();

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createNotes> | undefined} */
    let app;
    /** @type {ReturnType<typeof createShelf> | undefined} */
    let shelf;
    const editor = /** @type {HTMLTextAreaElement} */ (document.getElementById("note-text"));
    const tools = createShelfView(
      document,
      {
        open: (path) => shelf?.open(path),
        create: () => shelf?.create(),
        rename: (name) => shelf?.rename(name),
        remove: () => shelf?.remove(),
        filter: (text) => shelf?.filter(text),
      },
      { text: () => editor.value, editor },
    );
    const base = createView(
      document,
      {
        edit: (text) => {
          app?.edit(text);
          shelf?.typed();
        },
      },
      createCounter(startWorker),
    );
    // The note on screen also shows its tools and its place on the shelf.
    const view = {
      ...base,
      /** @param {Parameters<typeof base.note>[0]} model */
      note(model) {
        base.note(model);
        tools.note(model !== null);
        shelf?.shown();
      },
    };
    app = createNotes(ctx, view, { keepFiles, textChange, applyTextChange, isTextChange });
    shelf = createShelf(ctx, app, createLibrary({ bridge: ctx.bridge }), tools);
    // Unsaved text in ~/Notes is written before the window goes.
    addEventListener("pagehide", () => void shelf?.flush());
    // Brought back after the desk unloaded it: the desk's requests wait until the notes are open.
    await app.ready;
    await shelf.refresh();
  },
});
