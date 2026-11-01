// The data plugin: structured data and configuration files as a tree and raw text. It uses only the
// public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin, readBytes, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { createData } from "./data.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {ReturnType<typeof createData> | undefined} */
    let app;
    defineElements();
    const view = createView(document, {
      validateWith: () => app?.validateWith(),
      cancel: () => app?.cancel(),
    });
    app = createData(ctx, view, { readBytes, startWorker });
  },
});
