// Everything the pages call on the app beyond the store: the actions on containers, stacks and
// images, the menus, and the dialogs. Installed once the app exists, since each needs it.

import { createActions } from "./actions.js";
import { createImageActions } from "./actions-images.js";
import { openPullDialog, openTagDialog } from "./dialog-pull.js";
import { openRunDialog } from "./dialog-run.js";
import { containerMenu, imageMenu, stackMenu } from "./menus.js";

/** @param {import("./studio.js").App} app */
export function installFeatures(app) {
  const images = createImageActions(app);
  app.images = images;
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
    build: soon("Building"),
    composeUp: soon("Compose up from a file"),
    scaffold: soon("Writing a Dockerfile"),
    cleanup: soon("Clean up"),
  };
}
