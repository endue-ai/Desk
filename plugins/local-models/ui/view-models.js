// My models: every server answering and every model it has, with what each is and can do, and a
// way to add a server the window does not find by itself (another port, a computer on the network).
import { fill, h, icon, iconButton } from "./dom.js";
import { formatBytes, formatContext, modelKey } from "./models.js";
import { libraryView } from "./view-library.js";
import { capBadges } from "./view-picker.js";

/** @typedef {import("./app.js").App} App */

/** @param {App} app */
export function modelsView(app) {
  const { S } = app;
  const body = h("div.lm-page-body");
  const library = libraryView(app);
  /** @type {"local" | "servers"} */
  let tab = "local";
  const tabs = h("div.desk-tabs.lm-page-tabs", { role: "tablist" });
  const drawTabs = () => {
    fill(
      tabs,
      [
        ["local", "On this computer", "cpu"],
        ["servers", "Servers", "server"],
      ].map(([id, label, ic]) =>
        h(
          "button.desk-tab",
          {
            type: "button",
            role: "tab",
            "aria-selected": tab === id ? "true" : "false",
            onClick: () => {
              tab = /** @type {"local" | "servers"} */ (id);
              drawTabs();
            },
          },
          icon(/** @type {any} */ (ic)),
          label,
        ),
      ),
    );
    library.el.hidden = tab !== "local";
    body.hidden = tab !== "servers";
  };
  const el = h(
    "section.lm-page",
    null,
    h(
      "header.lm-page-head",
      null,
      h(
        "div",
        null,
        h("h1.lm-page-title", null, "My models"),
        h(
          "p.lm-page-sub",
          null,
          "Model files the built-in engine runs, and the models of every server answering.",
        ),
      ),
      h("div.lm-head-spacer"),
      h(
        "button.desk-btn",
        {
          type: "button",
          onClick: () => {
            void app.scan();
            void app.local.scan();
          },
        },
        icon("refresh"),
        "Look again",
      ),
    ),
    tabs,
    library.el,
    body,
  );
  const form = addServerForm(app);
  drawTabs();

  function draw() {
    const { servers, models, scanning, selected } = S.get();
    const total = models.length;
    const bytes = models.reduce((sum, m) => sum + (m.size ?? 0), 0);
    fill(
      body,
      h(
        "div.lm-summary",
        null,
        h(
          "div.desk-card.lm-stat",
          null,
          h(
            "span.lm-stat-value",
            null,
            String(servers.filter((s) => s.status === "online").length),
          ),
          h("span.lm-stat-label", null, "Servers answering"),
        ),
        h(
          "div.desk-card.lm-stat",
          null,
          h("span.lm-stat-value", null, String(total)),
          h("span.lm-stat-label", null, "Models"),
        ),
        h(
          "div.desk-card.lm-stat",
          null,
          h("span.lm-stat-value", null, String(models.filter((m) => m.loaded).length)),
          h("span.lm-stat-label", null, "In memory"),
        ),
        h(
          "div.desk-card.lm-stat",
          null,
          h("span.lm-stat-value", null, formatBytes(bytes) || "—"),
          h("span.lm-stat-label", null, "On disk"),
        ),
      ),
      servers.length
        ? servers.map((server) => {
            const mine = models.filter((m) => m.serverId === server.id);
            return h(
              "section.desk-card.lm-server-card",
              { dataset: { state: server.status } },
              h(
                "header.lm-server-head",
                null,
                h("span.lm-server-dot", { dataset: { state: server.status } }),
                h(
                  "div.lm-server-name",
                  null,
                  h("strong", null, server.label),
                  h("span.lm-muted", null, server.baseUrl),
                ),
                server.version ? h("span.desk-badge", null, server.version) : null,
                h("div.lm-head-spacer"),
                server.added
                  ? iconButton(
                      "trash",
                      "Forget this server",
                      () => void removeServer(app, server.id),
                    )
                  : null,
              ),
              server.status !== "online"
                ? h("p.lm-muted.lm-server-note", null, "Not answering. Start it, then look again.")
                : mine.length
                  ? h(
                      "table.desk-table.lm-model-table",
                      null,
                      h(
                        "thead",
                        null,
                        h(
                          "tr",
                          null,
                          ["Model", "Parameters", "Quantization", "Size", "Context", "Can", ""].map(
                            (t) => h("th", null, t),
                          ),
                        ),
                      ),
                      h(
                        "tbody",
                        null,
                        mine.map((m) =>
                          h(
                            "tr",
                            { dataset: { current: modelKey(m) === selected ? "1" : undefined } },
                            h(
                              "td",
                              null,
                              h(
                                "div.lm-model-cell",
                                null,
                                h("span.lm-pill-dot", {
                                  dataset: { state: m.loaded ? "loaded" : "ready" },
                                  title: m.loaded ? "In memory" : "On disk",
                                }),
                                h(
                                  "div",
                                  null,
                                  h("div.lm-model-name", null, m.name),
                                  h("div.lm-picker-id", null, m.id),
                                ),
                              ),
                            ),
                            h("td", null, m.params ?? "—"),
                            h("td", null, m.quant ? h("span.desk-badge", null, m.quant) : "—"),
                            h("td", null, formatBytes(m.size) || "—"),
                            h("td", null, formatContext(m.ctx) || "—"),
                            h("td", null, h("span.lm-picker-caps", null, capBadges(m))),
                            h(
                              "td.lm-row-actions",
                              null,
                              m.caps.includes("embedding")
                                ? null
                                : h(
                                    "button.desk-btn.desk-btn-quiet",
                                    {
                                      type: "button",
                                      onClick: () => {
                                        app.choose(modelKey(m));
                                        app.newChat(modelKey(m));
                                      },
                                    },
                                    icon("chat"),
                                    "Chat",
                                  ),
                            ),
                          ),
                        ),
                      ),
                    )
                  : h("p.lm-muted.lm-server-note", null, server.error ?? "No models yet."),
            );
          })
        : h(
            "div.desk-card.lm-server-card",
            null,
            h(
              "p.lm-muted.lm-server-note",
              null,
              scanning
                ? "Looking for model servers…"
                : "No model server answers on this computer's usual ports.",
            ),
          ),
      form,
    );
  }

  S.on(["servers", "models", "scanning", "selected"], draw);
  draw();
  return { el };
}

/** @param {App} app @param {string} id */
async function removeServer(app, id) {
  const saved = /** @type {import("./servers.js").ServerSpec[]} */ (
    (await app.store.get("servers")) ?? []
  );
  await app.store.set(
    "servers",
    saved.filter((s) => `${s.host.toLowerCase()}:${s.port}` !== id),
  );
  await app.reloadServers();
}

/** A server the window does not find by itself: an address, its kind, a key when it needs one. @param {App} app */
function addServerForm(app) {
  const address = /** @type {HTMLInputElement} */ (
    h("input.desk-field", {
      placeholder: "127.0.0.1:8081 or studio.local:11434",
      "aria-label": "Address",
    })
  );
  const kind = /** @type {HTMLSelectElement} */ (
    h(
      "select.desk-field",
      { "aria-label": "Kind" },
      h("option", { value: "" }, "Find out"),
      h("option", { value: "ollama" }, "Ollama"),
      h("option", { value: "openai" }, "OpenAI-compatible"),
    )
  );
  const key = /** @type {HTMLInputElement} */ (
    h("input.desk-field", {
      type: "password",
      placeholder: "Key (optional)",
      "aria-label": "API key",
    })
  );
  const note = h("span.lm-muted");
  const add = async () => {
    const m = /^(?:https?:\/\/)?([a-zA-Z0-9.-]+):(\d{1,5})\/?$/.exec(address.value.trim());
    if (!m) {
      fill(note, "Write it as host:port.");
      return;
    }
    const spec = {
      host: m[1],
      port: Number(m[2]),
      ...(kind.value ? { kind: /** @type {any} */ (kind.value) } : {}),
      ...(key.value ? { apiKey: key.value } : {}),
    };
    const saved = /** @type {import("./servers.js").ServerSpec[]} */ (
      (await app.store.get("servers")) ?? []
    );
    await app.store.set("servers", [
      ...saved.filter((s) => !(s.host === spec.host && s.port === spec.port)),
      spec,
    ]);
    address.value = "";
    key.value = "";
    fill(note, "");
    await app.reloadServers();
  };
  return h(
    "section.desk-card.lm-add-server",
    null,
    h("h2.lm-card-title", null, icon("plus"), "Add a server"),
    h(
      "p.lm-muted",
      null,
      "For a server on another port or another computer. A computer on the network is asked for once.",
    ),
    h(
      "div.lm-form-row",
      null,
      address,
      kind,
      key,
      h("button.desk-btn.desk-btn-primary", { type: "button", onClick: () => void add() }, "Add"),
      note,
    ),
  );
}
