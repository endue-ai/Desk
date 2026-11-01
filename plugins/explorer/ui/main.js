// The explorer plugin: the folders the person allows as a tree, files opened through the desk. It
// uses only the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createExplorer } from "./explorer.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createExplorer> | undefined} */
    let app;
    // The tools run the plugin's own commands, as a key or the palette would; a failure is said
    // on the status line by the command itself.
    const own = (/** @type {string} */ id) => () => app?.command(id, {}).catch(() => {});
    const view = createView(document, {
      select: (id) => app?.select(id),
      activate: (id) => app?.activate(id),
      key: (name) => app?.key(name),
      type: (letter) => app?.type(letter) === true,
      context: (id) => own(id)(),
      addFolder: own("endue.explorer.add-folder"),
      newFile: own("endue.explorer.new-file"),
      refresh: own("endue.explorer.refresh"),
      toggleHidden: own("endue.explorer.toggle-hidden"),
    });
    app = createExplorer(ctx, view);
    await app.start();
    window.addEventListener("pagehide", () => app?.dispose(), { once: true });
  },
});
