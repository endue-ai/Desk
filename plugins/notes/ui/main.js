// The notes plugin: Markdown and text files in one plain text area. It uses only the public SDK and
// bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createNotes } from "./notes.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {ReturnType<typeof createNotes> | undefined} */
    let app;
    const view = createView(document, { edit: (text) => app?.edit(text) });
    app = createNotes(ctx, view);
  },
});
