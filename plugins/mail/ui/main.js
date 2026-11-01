// The mail plugin: the person's mail as the desk's index holds it, acted on through the connector's
// commands. It uses only the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createMail } from "./mail.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createMail> | undefined} */
    let app;
    // Buttons and letters run the plugin's own commands, as a key or the palette would; a failure
    // is said on the status line by the command itself.
    const view = createView(document, {
      select: (id) => app?.select(id),
      activate: (id) => app?.activate(id),
      key: (name) => app?.key(name),
      more: () => app?.more(),
      mailbox: (id) => app?.setMailbox(id).catch(() => {}),
      account: (key) => app?.setAccount(key).catch(() => {}),
      search: (text) => app?.setSearch(text),
      command: (id, args) => app?.command(id, args ?? {}).catch(() => {}),
      openMessage: (key) => app?.command("endue.mail.show", keyArgs(key)).catch(() => {}),
      edit: (fields) => app?.writing.edit(fields),
      send: () => app?.command("endue.mail.send", {}).catch(() => {}),
      discard: () => app?.command("endue.mail.discard", {}).catch(() => {}),
      closeComposer: () => app?.writing.close(),
    });
    app = createMail(ctx, view);
    await app.start();
  },
});

/** `connector/instance#id` back into the arguments endue.mail.show takes. */
function keyArgs(/** @type {string} */ key) {
  const hash = key.indexOf("#");
  const [connector = "", instance = "default"] = key.slice(0, hash).split("/");
  return { source: { connector, instance }, id: key.slice(hash + 1) };
}
