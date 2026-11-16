// Which page draws which section or object: the studio asks this table by the section's id, or by
// the kind of the object opened.

import { h, icon } from "./dom.js";
import { createCompose } from "./view-compose.js";
import { createContainerPage } from "./view-container.js";
import { createContainers } from "./view-containers.js";
import { createDashboard } from "./view-dashboard.js";
import { createImagePage } from "./view-image.js";
import { createImages } from "./view-images.js";
import { createNetworkPage } from "./view-network.js";
import { createNetworks } from "./view-networks.js";
import { createVolumePage } from "./view-objects.js";
import { createStackPage } from "./view-stack.js";
import { createVolumes } from "./view-volumes.js";

/** A section still to come: says so rather than showing nothing. */
const later = (/** @type {string} */ title) => () => ({
  element: h(
    "div.page.empty-page",
    null,
    h("div.empty-art", null, icon("container", 40)),
    h("h2", null, title),
    h("p", null, "This section is on its way."),
  ),
  title,
  update() {},
});

/** @type {Record<string, (app: any, target?: any) => any>} */
export const PAGES = {
  dashboard: createDashboard,
  containers: createContainers,
  images: createImages,
  volumes: createVolumes,
  networks: createNetworks,
  compose: createCompose,
  builds: later("Builds"),
  hub: later("Explore images"),
  contexts: later("Contexts"),
  settings: later("Settings"),
  container: createContainerPage,
  image: createImagePage,
  project: createStackPage,
  volume: createVolumePage,
  network: createNetworkPage,
  missing: later("Not found"),
};
