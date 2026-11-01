// The archives plugin: every archive, package and disk image in one browser, with a preview and safe
// extraction. It uses only the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createArchives } from "./archives.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {ReturnType<typeof createArchives> | undefined} */
    let app;
    const view = createView(document, {
      select: (id) => app?.select(id),
      toggle: (id) => app?.toggle(id),
      open: (id) => app?.open(id),
      up: () => app?.up(),
      sort: (by) => app?.sort(by),
      filter: (text) => app?.filter(text),
      mark: (id) => app?.mark(id),
      extract: (which) => app?.extract(which),
      stop: () => app?.stop(),
    });
    app = createArchives(ctx, view);
  },
});
