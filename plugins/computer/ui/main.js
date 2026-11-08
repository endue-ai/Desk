// endue.computer: Eris uses the computer (ADR 0123), through computer.* as any plugin with
// computer:see and computer:control would. The tested modules take the context from here.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createComputer } from "./app.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createComputer> | undefined} */
    let app;
    const view = createView(document, {
      ask: (permission) => void app?.page.ask(permission),
      openSettings: (permission) => void app?.page.openSettings(permission),
      stop: () => void app?.page.stop(),
      resume: () => void app?.page.resume(),
      addApp: (id) => void app?.page.addApp(id),
      removeApp: (id) => void app?.page.removeApp(id),
      refresh: () => void app?.page.refresh(),
    });
    app = createComputer(ctx, view);
    await app.ready;
  },
});
