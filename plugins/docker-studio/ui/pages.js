// Which page draws which section or object: the studio asks this table by the section's id, or by
// the kind of the object opened.

import { h, icon } from "./dom.js";
import { createDashboard } from "./view-dashboard.js";

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
  containers: later("Containers"),
  images: later("Images"),
  volumes: later("Volumes"),
  networks: later("Networks"),
  compose: later("Compose"),
  builds: later("Builds"),
  hub: later("Explore images"),
  contexts: later("Contexts"),
  settings: later("Settings"),
  missing: later("Not found"),
};
