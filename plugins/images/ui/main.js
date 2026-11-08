// The images plugin: every still image in one viewer. It uses only the public SDK and bridge API,
// exactly as a community plugin would.
import { defineUiPlugin, readBytes, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { createImages } from "./images.js";
import { paint } from "./paint.js";
import { createView } from "./view.js";

defineElements();

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown> | undefined} */
    let app;
    const view = createView(document, (action, ...args) => app?.[action]?.(...args), { paint });
    app = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
      /** @type {unknown} */ (createImages(ctx, view, { read: readBytes, startWorker }))
    );
  },
});
