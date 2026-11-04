// The projects plugin: the person's tasks from Jira, Linear, Asana and any other task connector, as
// the desk's index holds them, in six views, acted on through the connectors' commands. It uses
// only the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createProjects } from "./app.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createProjects> | undefined} */
    let app;
    // Buttons and letters run the plugin's own commands, as a key or the palette would; a failure
    // is said on the status line by the command itself.
    const view = createView(document, {
      select: (key) => app?.select(key),
      open: (key) => app?.open(key),
      key: (name) => app?.key(name),
      command: (id, args) => app?.command(id, args ?? {}).catch(() => {}),
      sort: (field) => app?.sortBy(field),
      drop: (at) => app?.drop(at),
      connect: () => app?.connect(),
    });
    app = createProjects(ctx, view);
    await app.start();
  },
});
