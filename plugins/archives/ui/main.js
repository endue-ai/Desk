// The archives plugin: every archive, package and disk image in one browser, with a preview and safe
// extraction. It uses only the public SDK and bridge API, exactly as a community plugin would; RAR,
// disk images, DMGs, SquashFS, WIM and 7z come from the library plugin endue.formats.
import { byteSource, defineUiPlugin, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { createArchives } from "./archives.js";
import { createView } from "./view.js";

defineElements();

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
    app = createArchives(ctx, view, { byteSource, startWorker });
  },
});
