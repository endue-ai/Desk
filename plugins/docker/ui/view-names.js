// What the surface calls each list: its tab's title, the kind of row it counts, and the one row a
// list shows while it has nothing to draw: "Reading…", or that its read failed (and, when the
// engine is away, why; another failure's words are in the status line).

import { el } from "./dom.js";

/** @typedef {import("./view-types.js").ListName} ListName */

export const TITLES = /** @type {Record<ListName, string>} */ ({
  overview: "Overview",
  containers: "Containers",
  compose: "Compose",
  images: "Images",
  volumes: "Volumes",
  networks: "Networks",
});

/** The kind of row each list counts. */
export const COUNTED = /** @type {Record<string, string>} */ ({
  containers: "container",
  compose: "project",
  images: "image",
  volumes: "volume",
  networks: "network",
});

/** What each list holds, as "Could not read …" names it. */
const HOLDS = /** @type {Record<ListName, string>} */ ({
  overview: "the overview",
  containers: "the containers",
  compose: "the Compose projects",
  images: "the images",
  volumes: "the volumes",
  networks: "the networks",
});

/**
 * The row of a list with no model.
 * @param {Document} doc
 * @param {ListName} name
 * @param {boolean} failed Its read failed.
 * @param {boolean} away The engine does not answer.
 */
export function emptyRow(doc, name, failed, away) {
  const text = failed
    ? `Could not read ${HOLDS[name]}${away ? ": Docker is not reachable" : ""}.`
    : "Reading…";
  return el(doc, "div", { class: "row empty" }, el(doc, "span", { class: "desk-muted" }, text));
}
