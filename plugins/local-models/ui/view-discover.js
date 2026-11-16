// Discover: search Hugging Face for GGUF models, sorted and narrowed by what they do; a repository
// chosen shows beside the results; Ollama models pull by name; the downloads run below. Nothing is
// asked of the internet until the page opens or the person searches.
import { ago, fill, h, icon } from "./dom.js";
import { details, HubError, readme, repoCaps, SORTS, search } from "./hub.js";
import { paramsOf } from "./models.js";
import { downloadsView } from "./view-downloads.js";
import { count, errorView, hubModelView, loadingView } from "./view-hub-model.js";
import { CAPS } from "./view-picker.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./hub.js").HubRepo} HubRepo
 */

const KINDS = [
  { id: "all", label: "All" },
  { id: "vision", label: "Vision" },
  { id: "reasoning", label: "Reasoning" },
  { id: "code", label: "Code" },
  { id: "embedding", label: "Embedding" },
];

/** @param {App} app */
export function discoverView(app) {
  const { S } = app;
  const bridge = app.store.bridge;
  /** @type {HubRepo[]} */
  let results = [];
  let kind = "all";
  /** @type {string | null} */
  let chosen = null;
  let asked = false;
  let busy = false;
  /** @type {string | null} */
  let failure = null;
  let seq = 0;

  const field = /** @type {HTMLInputElement} */ (
    h("input.desk-field.lm-hub-search", {
      type: "search",
      placeholder: "Search models on Hugging Face: qwen3, gemma 3, coder…",
      "aria-label": "Search models",
    })
  );
  const sort = /** @type {HTMLSelectElement} */ (
    h(
      "select.desk-field.lm-hub-sort",
      { "aria-label": "Sort" },
      Object.entries(SORTS).map(([v, label]) => h("option", { value: v }, label)),
    )
  );
  const kinds = h("div.desk-tabs.lm-seg.lm-hub-kinds", { role: "radiogroup" });
  const list = h("div.lm-hub-list");
  const detail = h("div.lm-hub-detail");
  const pullField = /** @type {HTMLInputElement} */ (
    h("input.desk-field", { placeholder: "llama3.2:3b", "aria-label": "Ollama model name" })
  );
  const pullRow = h("div.lm-hub-pull");
  const el = h(
    "section.lm-page.lm-discover",
    null,
    h(
      "header.lm-page-head",
      null,
      h(
        "div",
        null,
        h("h1.lm-page-title", null, "Discover"),
        h(
          "p.lm-page-sub",
          null,
          "Models from Hugging Face, in GGUF files the built-in engine runs. Only searches and downloads go online; chats never do.",
        ),
      ),
    ),
    h(
      "div.lm-hub-bar",
      null,
      h("label.lm-search-wrap.lm-hub-field", null, icon("search"), field),
      sort,
      kinds,
    ),
    h("div.lm-hub-body", null, list, detail),
    pullRow,
    downloadsView(app).el,
  );

  async function run() {
    const mine = ++seq;
    busy = true;
    failure = null;
    draw();
    try {
      const found = await search(bridge, { q: field.value, sort: /** @type {any} */ (sort.value) });
      if (mine !== seq) return;
      results = found;
      if (!chosen && results[0]) void open(results[0].id);
    } catch (e) {
      if (mine !== seq) return;
      failure = e instanceof HubError ? e.message : String(e);
      results = [];
    }
    busy = false;
    draw();
  }

  /** @param {string} id */
  async function open(id) {
    chosen = id;
    draw();
    fill(detail, loadingView());
    try {
      const [d, card] = await Promise.all([details(bridge, id), readme(bridge, id)]);
      if (chosen !== id) return;
      const paint = () => chosen === id && fill(detail, hubModelView(app, d, card));
      paint();
      const off = S.on(["downloads", "local", "memory"], () => (chosen === id ? paint() : off()));
    } catch (e) {
      if (chosen === id) errorView(detail, e instanceof Error ? e.message : String(e));
    }
  }

  /** @param {HubRepo} r */
  function card(r) {
    const caps = repoCaps(r);
    const [org, name] = r.id.split("/");
    return h(
      "button.desk-row.lm-hub-card-row",
      {
        type: "button",
        "aria-current": chosen === r.id ? "true" : undefined,
        dataset: { active: chosen === r.id ? "1" : undefined },
        onClick: () => void open(r.id),
      },
      h("div.lm-hub-avatar", null, org.slice(0, 1).toUpperCase()),
      h(
        "div.lm-hub-card-main",
        null,
        h("div.lm-hub-card-name", null, name.replace(/[-_.]?gguf$/i, "")),
        h(
          "div.lm-hub-card-meta",
          null,
          h("span", null, org),
          paramsOf(name) ? h("span", null, paramsOf(name)) : null,
          h("span", null, icon("download"), count(r.downloads)),
          h("span", null, "♥ ", count(r.likes)),
          r.updated ? h("span", null, ago(Date.parse(r.updated))) : null,
        ),
      ),
      h(
        "span.lm-picker-caps",
        null,
        caps.map((c) =>
          h("span.lm-cap", { title: CAPS[c].label, dataset: { cap: c } }, icon(CAPS[c].icon)),
        ),
      ),
    );
  }

  function draw() {
    fill(
      kinds,
      KINDS.map((k) =>
        h(
          "button.desk-tab",
          {
            type: "button",
            role: "radio",
            "aria-selected": k.id === kind ? "true" : "false",
            "aria-checked": k.id === kind ? "true" : "false",
            onClick: () => {
              kind = k.id;
              draw();
            },
          },
          k.label,
        ),
      ),
    );
    const shown =
      kind === "all"
        ? results
        : results.filter((r) => repoCaps(r).includes(/** @type {any} */ (kind)));
    el.dataset.detail = chosen ? "1" : "";
    fill(
      list,
      failure
        ? h("div.lm-msg-error", null, icon("x"), h("span", null, failure))
        : busy && !results.length
          ? h("div.lm-hub-loading", null, h("span.lm-spinner"), "Searching…")
          : shown.length
            ? shown.map(card)
            : h(
                "div.lm-side-empty",
                null,
                asked ? "No GGUF repositories match." : "Search to see models.",
              ),
    );
    const ollama = S.get().servers.find((s) => s.kind === "ollama" && s.status === "online");
    pullRow.hidden = !ollama;
    if (ollama)
      fill(
        pullRow,
        icon("server"),
        h(
          "span",
          null,
          h("strong", null, "Pull into Ollama"),
          h("span.lm-muted", null, " — any model from the Ollama library, by name"),
        ),
        pullField,
        h(
          "button.desk-btn",
          {
            type: "button",
            onClick: () => {
              const name = pullField.value.trim();
              if (!name) return pullField.focus();
              app.local.downloads.add({ kind: "ollama", name, server: ollama.id, total: 0 });
              pullField.value = "";
            },
          },
          icon("download"),
          "Pull",
        ),
      );
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let typing;
  field.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      asked = true;
      chosen = null;
      void run();
    }, 350);
  });
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(typing);
      asked = true;
      chosen = null;
      void run();
    }
  });
  sort.addEventListener("change", () => void run());
  S.on(["servers"], draw);
  S.on(["view"], (s) => {
    if (s.view === "discover" && !asked) {
      asked = true;
      void run();
    }
  });
  draw();
  if (S.get().view === "discover") {
    asked = true;
    void run();
  }
  return { el };
}
