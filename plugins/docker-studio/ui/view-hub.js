// Explore images: search the registry (docker search) with a few well-known images to start from;
// each result says whether it is official, how many stars it has and whether it is already here,
// with Pull and Run.

import { button, h, icon, pill } from "./dom.js";
import { count } from "./format.js";
import { searchImages } from "./image-search.js";

/** @typedef {import("./studio.js").App} App */

const STARTERS = [
  ["nginx", "Web server and reverse proxy", "hub"],
  ["postgres", "Relational database", "volume"],
  ["redis", "In-memory store and cache", "memory"],
  ["node", "JavaScript runtime", "terminal"],
  ["python", "Python runtime", "terminal"],
  ["mysql", "Relational database", "volume"],
  ["mongo", "Document database", "volume"],
  ["alpine", "A 5 MB Linux to build on", "layers"],
  ["traefik", "Edge router for containers", "network"],
  ["grafana/grafana", "Dashboards and alerts", "chart"],
  ["ollama/ollama", "Run language models locally", "sparkle"],
  ["ubuntu", "General purpose Linux", "layers"],
];

/** @param {App} app */
export function createHub(app) {
  const results = h("div.hub-results");
  const status = h("p.muted.hub-status");
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let last = "";
  const here = () =>
    new Set(app.store.state.images.flatMap((i) => i.refs.map((r) => r.split(":")[0])));

  const card = (
    /** @type {string} */ name,
    /** @type {string} */ about,
    /** @type {{ official?: boolean, stars?: number, icon?: import("./dom.js").IconName }} */ o = {},
  ) =>
    h(
      "article.card.hub-card",
      null,
      h(
        "div.hub-top",
        null,
        h("span.result-icon", null, icon(o.icon ?? (o.official ? "shield" : "layers"), 18)),
        h(
          "div.hub-name",
          null,
          h("b", null, name),
          h(
            "span.hub-pills",
            null,
            o.official ? pill("Official", "accent") : null,
            here().has(name) || here().has(`docker.io/library/${name}`) ? pill("Here", "ok") : null,
          ),
        ),
        o.stars !== undefined ? h("span.stars", null, icon("star", 13), count(o.stars)) : null,
      ),
      h("p.hub-about", null, about || "No description."),
      h(
        "div.hub-actions",
        null,
        button({
          label: "Pull",
          icon: "download",
          kind: "desk-btn-quiet",
          onClick: () => app.dialogs.pull(name),
        }),
        button({
          label: "Run",
          icon: "play",
          kind: "desk-btn-quiet",
          onClick: () => app.dialogs.run(`${name}:latest`),
        }),
      ),
    );

  const starters = () => {
    status.textContent = "Well-known images to start from";
    results.replaceChildren(
      ...STARTERS.map(([name, about, ic]) =>
        card(name ?? "", about ?? "", { icon: /** @type {any} */ (ic) }),
      ),
    );
  };

  const search = async (/** @type {string} */ term) => {
    last = term;
    if (term.trim().length < 2) return starters();
    status.replaceChildren(h("span.spinner"), " Searching the registry…");
    try {
      const rows = await searchImages(app.docker, term);
      if (term !== last) return;
      status.textContent = `${rows.length} images for “${term.trim()}”`;
      results.replaceChildren(
        ...rows.map(({ name, description, official, stars }) =>
          card(name, description, { official, stars }),
        ),
      );
    } catch (error) {
      if (term !== last) return;
      status.textContent = String(/** @type {any} */ (error)?.message ?? error);
      results.replaceChildren();
    }
  };

  const box = /** @type {HTMLInputElement} */ (
    h("input.desk-field.hub-search", {
      type: "search",
      placeholder: "Search Docker Hub: postgres, node, a team's images…",
      "aria-label": "Search the registry",
      onInput: () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void search(box.value), 350);
      },
    })
  );
  const element = h(
    "div.page.hub",
    null,
    h(
      "section.hub-hero",
      null,
      h("h2", null, "Find an image to run"),
      h("p.muted", null, "From Docker Hub, through this engine's docker search."),
      h("label.search-wrap.wide.big", null, icon("search", 18), box),
    ),
    status,
    results,
  );
  starters();
  queueMicrotask(() => box.focus());
  return {
    element,
    title: "Explore images",
    subtitle: "Docker Hub",
    tools: () => [
      button({
        label: "Pull by name",
        icon: "download",
        kind: "desk-btn-primary",
        onClick: () => app.dialogs.pull(),
      }),
    ],
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("images") && !last) starters();
    },
    search: (/** @type {string} */ text) => {
      box.value = text;
      void search(text);
    },
  };
}
