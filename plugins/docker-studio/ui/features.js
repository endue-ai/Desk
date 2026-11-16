// Everything the pages call on the app beyond the store: the actions on containers, stacks and
// images, the menus, and the dialogs. Installed once the app exists, since each needs it.

import { createActions } from "./actions.js";
import { createBuilds } from "./actions-build.js";
import { createImageActions } from "./actions-images.js";
import { createObjectActions } from "./actions-objects.js";
import { createAssistant } from "./assistant.js";
import { openBuildDialog } from "./dialog-build.js";
import { openComposeDialog } from "./dialog-compose.js";
import { openNetworkDialog, openVolumeDialog } from "./dialog-objects.js";
import { openPullDialog, openTagDialog } from "./dialog-pull.js";
import { openRunDialog } from "./dialog-run.js";
import { openScaffoldDialog } from "./dialog-scaffold.js";
import { containerMenu, imageMenu, stackMenu } from "./menus.js";

/** @param {import("./studio.js").App} app */
export function installFeatures(app) {
  const images = createImageActions(app);
  app.images = images;
  app.objects = createObjectActions(app);
  app.builds = createBuilds(app);
  app.ai = createAssistant(app);
  app.act = {
    ...createActions(app),
    removeImages: images.removeImages,
    pruneImages: images.pruneImages,
  };
  app.menus = {
    container: (/** @type {any[]} */ rows, /** @type {any} */ at) => containerMenu(app, rows, at),
    stack: (/** @type {any} */ s, /** @type {any} */ at) => stackMenu(app, s, at),
    image: (/** @type {any[]} */ rows, /** @type {any} */ at) => imageMenu(app, rows, at),
  };
  const soon = (/** @type {string} */ what) => () =>
    app.toast(`${what} comes in a later step of this branch.`, "info");
  app.dialogs = {
    run: (/** @type {string} */ ref) => openRunDialog(app, ref),
    pull: () => openPullDialog(app),
    pullRef: (/** @type {string} */ ref) => openPullDialog(app, ref),
    tag: (/** @type {any} */ image) => openTagDialog(app, image),
    createVolume: () => openVolumeDialog(app),
    createNetwork: () => openNetworkDialog(app),
    build: (/** @type {any} */ preset) => openBuildDialog(app, preset),
    composeUp: () => openComposeDialog(app),
    scaffold: () => openScaffoldDialog(app),
    cleanup: soon("Clean up"),
  };
}
