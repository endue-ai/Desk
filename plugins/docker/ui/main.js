// The Docker plugin: containers, Compose projects, images, volumes and networks of the engine the
// docker program reaches, on one surface. It uses only the public SDK and bridge API, exactly as a
// community plugin would.
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { wireCommands } from "./commands.js";
import { createDocker } from "./docker.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown>} */
    let keys = {};
    const view = createView(document, (action, ...args) => keys[action]?.(...args));
    const cancelled = (/** @type {string} */ message) =>
      new CommandFailed("endue.docker.cancel", "cancelled", message);
    const app = createDocker(ctx, view, { cancelled });
    keys = wireCommands(ctx, app, view);
  },
});
