// The slides plugin: every presentation in one viewer with a rail, notes and play mode. It uses only
// the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin, readBytes, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { createSlides } from "./slides.js";
import { createView } from "./view.js";

defineElements();

defineUiPlugin({
  mount(ctx) {
    /** @type {ReturnType<typeof createSlides> | undefined} */
    let app;
    const view = createView(document, { external: (url) => app?.external(url) });
    app = createSlides(ctx, view, { read: readBytes, startWorker });
  },
});
