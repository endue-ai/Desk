// The docs plugin: every word-processor document in one page view. It uses only the public SDK and
// bridge API, exactly as a community plugin would.
import { defineUiPlugin, readBytes, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { createDocs } from "./docs.js";
import { createView } from "./view/view.js";

defineElements();

defineUiPlugin({
  mount(ctx) {
    /** @type {ReturnType<typeof createDocs> | undefined} */
    let app;
    const view = createView(document, { external: (url) => app?.external(url) });
    app = createDocs(ctx, view, { read: readBytes, startWorker });
  },
});
