// The notes plugin: Markdown and text files in one plain text area. It uses only the public SDK and
// bridge API, exactly as a community plugin would.
import { defineUiPlugin, startWorker } from "@endue-ai/plugin-sdk";
import { createCounter } from "./counter.js";
import { createNotes } from "./notes.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createNotes> | undefined} */
    let app;
    const view = createView(
      document,
      { edit: (text) => app?.edit(text) },
      createCounter(startWorker),
    );
    app = createNotes(ctx, view);
    // Brought back after the desk unloaded it: the desk's requests wait until the notes are open.
    await app.ready;
  },
});
