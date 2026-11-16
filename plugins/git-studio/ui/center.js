// The centre of the window shows one page at a time: the graph, or a file's diff, the conflict
// tool, blame or a file's history over it. Each page is an element of its own, kept while hidden so
// it comes back as it was; app.center says which one shows.

import { h } from "./dom.js";

/**
 * @param {import("./app.js").App} app
 * @param {HTMLElement} graphHost
 * @param {HTMLElement} viewHost
 */
export function createCenter(app, graphHost, viewHost) {
  /** @type {Map<import("./app.js").Center, HTMLElement>} */
  const pages = new Map();

  /** A page for `name`, made once. @param {import("./app.js").Center} name */
  function page(name) {
    let el = pages.get(name);
    if (!el) {
      el = h("div.view-page", { dataset: { page: name }, hidden: true });
      pages.set(name, el);
      viewHost.append(el);
    }
    return el;
  }

  function draw() {
    const name = app.get().center;
    graphHost.hidden = name !== "graph";
    viewHost.hidden = name === "graph";
    for (const [key, el] of pages) el.hidden = key !== name;
  }

  app.subscribe((state, previous) => {
    if (state.center !== previous.center) draw();
  });
  draw();
  return {
    page,
    /** @param {import("./app.js").Center} name */
    show: (name) => app.set({ center: name }),
    back: () => app.set({ center: "graph" }),
  };
}
