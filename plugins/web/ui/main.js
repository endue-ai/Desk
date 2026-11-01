// The web plugin: saved pages, web archives, link files and feeds, drawn safely in one surface.
// It uses only the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createView } from "./view.js";
import { createWeb } from "./web.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {ReturnType<typeof createWeb> | undefined} */
    let app;
    const view = createView(document, {
      open: (path) => app?.open(path),
      say: (text) => app?.say(text),
    });
    app = createWeb(ctx, view);
  },
});
