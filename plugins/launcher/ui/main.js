// Launcher: a grid of every plugin that opens on the desk, over the whole app. The public SDK and
// bridge API only, as a community plugin would. launcher.js holds the behaviour, model.js what is
// listed and in which order, view.js the DOM.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createLauncher } from "./launcher.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createLauncher> | undefined} */
    let app;
    const view = createView(document, {
      type: (text) => app?.type(text),
      move: (step) => app?.move(step),
      launch: (id) => void app?.launch(id),
      close: () => app?.close(),
    });
    app = createLauncher(
      {
        call: (method, params) => ctx.bridge.call(method, params),
        run: (command, args) => ctx.commands.run(command, args),
        show: () => ctx.surface.show(),
        hide: () => ctx.surface.hide(),
      },
      view,
    );
    ctx.commands.on("endue.launcher.open", () => app?.toggle());
    ctx.commands.on("endue.launcher.close", () => app?.close());
  },
});
