// Local models: a client for the language models that run on this computer, on the public SDK and
// bridge only, exactly as a community plugin would be.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createApp } from "./app.js";
import { wireCommands } from "./commands.js";
import { mountShell } from "./view-shell.js";

defineUiPlugin({
  mount(ctx) {
    const app = createApp(ctx.bridge);
    mountShell(app, document.body);
    wireCommands(ctx, app);
    void app.start().then(() => {
      document.body.dataset.ready = "1";
    });
  },
});
