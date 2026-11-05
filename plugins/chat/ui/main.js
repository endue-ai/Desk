// The chat plugin: every chat service the desk's connectors bring in (Slack, Discord, Teams, ...)
// in one interface, acted on through the connectors' commands. It uses only the public SDK and
// bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createChat } from "./chat.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createChat> | undefined} */
    let app;
    const quiet = (/** @type {unknown} */ outcome) =>
      Promise.resolve(outcome).catch(() => {
        // The command said its failure on the status line already.
      });
    // Buttons and letters run the plugin's own commands, as a key or the palette would.
    const view = createView(document, {
      command: (id, args) => quiet(app?.command(id, args ?? {})),
      open: (key) => quiet(app?.openConversation(key)),
      activate: (key) => quiet(app?.activate(key)),
      select: (key) => app?.select(key),
      key: (name, where) => app?.key(name, where) ?? false,
      more: (where) => quiet(app?.more(where)),
      type: (target, text) => app?.type(target, text),
      cancelEdit: () => app?.cancelEdit() ?? false,
      closeThread: () => app?.closeThread() ?? false,
      retry: (key) => quiet(app?.retry(key)),
      discard: (key) => app?.discard(key),
      link: (url) => quiet(app?.link(url)),
    });
    app = createChat(ctx, view);
    await app.start();
  },
});
