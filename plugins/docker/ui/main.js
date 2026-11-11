// The Docker plugin: containers, Compose projects, images, volumes and networks of the engine the
// docker program reaches, on one surface. It uses only the public SDK and bridge API, exactly as a
// community plugin would.
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { wireCommands } from "./commands.js";
import { createDockerDrops } from "./dnd.js";
import { createDocker } from "./docker.js";
import { pageOf } from "./reach.js";
import { createView } from "./view.js";
import { createDropView } from "./view-dnd.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown>} */
    let keys = {};
    const view = createView(document, (action, ...args) => keys[action]?.(...args));
    const cancelled = (/** @type {string} */ message) =>
      new CommandFailed("endue.docker.cancel", "cancelled", message);
    // While no engine answers, docker is asked after it only while this page can be seen.
    const app = createDocker(ctx, view, { cancelled, page: pageOf(document) });
    keys = wireCommands(ctx, app, view);
    createDockerDrops(ctx, app, createDropView(document, ctx.dnd));
  },
});
