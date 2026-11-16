// Models on this computer: this computer's memory, the models the built-in engine has loaded (their
// progress, port, settings, log, eject), the models folders, and every .gguf file in them with what it
// is and whether it fits. A file chosen opens its details and load settings beside the list.
import { fill, h, icon, iconButton } from "./dom.js";
import { FIT_WORDS, fitOf, needBytes } from "./memory.js";
import { formatBytes, formatContext } from "./models.js";
import { loadPanel } from "./view-load.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./library.js").LocalModel} LocalModel
 */

/** "24 GB unified memory". @param {import("./memory.js").Memory | undefined} m */
const memoryWords = (m) => {
  if (!m) return "Memory not known here";
  // Memory is sold in binary gigabytes: 24 GB, not 25.8.
  const gb = (/** @type {number} */ n) => `${Math.round(n / 1024 ** 3)} GB`;
  return m.kind === "unified"
    ? `${gb(m.total)} unified memory`
    : `${gb(m.gpu ?? m.total)} GPU memory`;
};

/** @param {App} app */
export function libraryView(app) {
  const { S } = app;
  /** @type {string | null} */
  let chosen = null;
  /** @type {Set<string>} */
  const openLogs = new Set();
  const list = h("div.lm-lib-list");
  const detail = h("aside.lm-lib-detail");
  const el = h("div.lm-lib", null, list, detail);

  /** @param {import("./local.js").EngineView} e */
  function engineCard(e) {
    const model = S.get().local.find((m) => m.path === e.path);
    const log = openLogs.has(e.id) ? app.local.logOf(e.id).slice(-60) : [];
    return h(
      "div.desk-card.lm-engine",
      { dataset: { state: e.state } },
      h(
        "div.lm-engine-head",
        null,
        h("span.lm-server-dot", {
          dataset: {
            state: e.state === "ready" ? "online" : e.state === "failed" ? "offline" : "checking",
          },
        }),
        h(
          "div.lm-engine-name",
          null,
          h("strong", null, model?.name ?? e.alias),
          h(
            "span.lm-muted",
            null,
            `:${e.port} · ${formatContext(e.config.ctx)} context${e.config.gpuLayers !== undefined ? ` · ${e.config.gpuLayers} GPU layers` : ""}`,
          ),
        ),
        h("div.lm-head-spacer"),
        e.state === "ready"
          ? h(
              "button.desk-btn.desk-btn-quiet",
              { type: "button", onClick: () => model && void app.local.load(model) },
              icon("chat"),
              "Chat",
            )
          : null,
        iconButton("terminal", openLogs.has(e.id) ? "Hide the log" : "Show the log", () => {
          if (openLogs.has(e.id)) openLogs.delete(e.id);
          else openLogs.add(e.id);
          draw();
        }),
        e.state === "failed"
          ? iconButton("x", "Dismiss", () => app.local.dismiss(e.id))
          : h(
              "button.desk-btn",
              { type: "button", onClick: () => void app.local.eject(e.id) },
              icon("eject"),
              "Eject",
            ),
      ),
      e.state === "starting"
        ? h(
            "div.desk-progress.lm-engine-bar",
            null,
            h("span", { style: { width: `${Math.round((e.progress ?? 0) * 100)}%` } }),
          )
        : null,
      e.error ? h("div.lm-msg-error", null, icon("x"), h("span", null, e.error)) : null,
      log.length ? h("pre.lm-log", null, log.join("\n")) : null,
    );
  }

  /** @param {LocalModel} m */
  function row(m) {
    const inst = app.local.instanceOf(m.path);
    const config = app.local.configFor(m);
    const fit = fitOf(
      needBytes({ ...m.info, size: m.size }, { ctx: config.ctx, cache: config.cacheType }),
      S.get().memory,
    );
    return h(
      "tr",
      {
        dataset: { chosen: chosen === m.path ? "1" : undefined },
        onClick: () => {
          chosen = m.path;
          draw();
        },
      },
      h(
        "td",
        null,
        h(
          "div.lm-model-cell",
          null,
          h("span.lm-pill-dot", {
            dataset: { state: inst?.state === "ready" ? "loaded" : "ready" },
          }),
          h(
            "div",
            null,
            h("div.lm-model-name", null, m.name),
            h(
              "div.lm-picker-id",
              { title: m.path },
              [m.info?.arch, m.repo ?? m.file].filter(Boolean).join(" · "),
            ),
          ),
        ),
      ),
      h("td", null, m.info?.sizeLabel ?? "—"),
      h("td", null, m.info?.quant ? h("span.desk-badge", null, m.info.quant) : "—"),
      h("td", null, formatBytes(m.size)),
      h("td", null, formatContext(m.info?.ctx) || "—"),
      h(
        "td",
        null,
        fit === "unknown"
          ? "—"
          : h("span.lm-fit-chip", { dataset: { fit }, title: FIT_WORDS[fit] }, FIT_WORDS[fit]),
      ),
      h(
        "td.lm-row-actions",
        null,
        m.error
          ? h("span.lm-bad", { title: m.error }, "Unreadable")
          : inst
            ? h(
                "button.desk-btn.desk-btn-quiet",
                {
                  type: "button",
                  onClick: (/** @type {Event} */ e) => {
                    e.stopPropagation();
                    void app.local.eject(inst.id);
                  },
                },
                icon("eject"),
                "Eject",
              )
            : h(
                "button.desk-btn",
                {
                  type: "button",
                  onClick: (/** @type {Event} */ e) => {
                    e.stopPropagation();
                    void app.local.load(m);
                  },
                },
                icon("play"),
                "Load",
              ),
      ),
    );
  }

  /** @param {LocalModel} m */
  function drawDetail(m) {
    const i = m.info;
    const facts = [
      ["Architecture", i?.arch],
      ["Parameters", i?.sizeLabel],
      ["Quantization", i?.quant],
      ["Trained context", i?.ctx ? `${formatContext(i.ctx)} tokens` : undefined],
      ["Layers", i?.layers],
      [
        "Attention heads",
        i?.heads && i.kvHeads ? `${i.heads} (${i.kvHeads} for keys and values)` : i?.heads,
      ],
      ["Experts", i?.experts],
      ["Vocabulary", i?.vocab?.toLocaleString()],
      ["License", i?.license],
      ["By", i?.author],
      ["File", m.parts ? `${m.file} (${m.parts} parts)` : m.file],
      ["Folder", m.folder],
    ].filter(([, v]) => v !== undefined && v !== "");
    fill(
      detail,
      h(
        "header.lm-lib-detail-head",
        null,
        h(
          "div",
          null,
          h("h2.lm-card-title", null, m.name),
          h("div.lm-muted", null, formatBytes(m.size)),
        ),
        h("div.lm-head-spacer"),
        iconButton("trash", "Move to the Trash", async () => {
          await app.local.remove(m);
          chosen = null;
          draw();
        }),
        iconButton("x", "Close", () => {
          chosen = null;
          draw();
        }),
      ),
      h(
        "dl.lm-facts",
        null,
        facts.flatMap(([k, v]) => [h("dt", null, String(k)), h("dd", null, String(v))]),
      ),
      i?.chatTemplate
        ? h(
            "details.lm-template",
            null,
            h("summary", null, "Chat template"),
            h("pre", null, i.chatTemplate),
          )
        : null,
      h("h3.lm-sub", null, "Load settings"),
      h("div", null, loadPanel(app, m, { onDone: draw })),
    );
  }

  async function pickFolder() {
    const answer = await app.store.bridge
      .call("dialog.open", { kind: "folders", title: "A folder of .gguf models" })
      .catch(() => undefined);
    const path = answer?.paths?.[0];
    if (path) await app.local.addFolder(path);
  }

  function draw() {
    const { local, engines, memory, folders, libraryScanning } = S.get();
    const total = local.reduce((sum, m) => sum + m.size, 0);
    fill(
      list,
      h(
        "div.lm-lib-top",
        null,
        h(
          "div.desk-card.lm-stat",
          null,
          h("span.lm-stat-value", null, icon("cpu"), memoryWords(memory)),
          h(
            "span.lm-stat-label",
            null,
            memory?.kind === "unified"
              ? "About three quarters of it can hold a model"
              : "What a model must fit in to run fast",
          ),
        ),
        h(
          "div.desk-card.lm-stat",
          null,
          h("span.lm-stat-value", null, String(local.length)),
          h("span.lm-stat-label", null, `Model files · ${formatBytes(total) || "0 B"}`),
        ),
        h(
          "div.desk-card.lm-stat",
          null,
          h("span.lm-stat-value", null, String(engines.filter((e) => e.state === "ready").length)),
          h("span.lm-stat-label", null, "Loaded in the built-in engine"),
        ),
      ),
      engines.length ? h("section.lm-engines", null, engines.map(engineCard)) : null,
      h(
        "div.lm-folders",
        null,
        h("span.lm-muted", null, "Folders"),
        h(
          "span.lm-folder-chip",
          { title: "The window's own folder: downloads go here" },
          icon("folder"),
          "~/.endue/local-models/models",
        ),
        folders.map((f) =>
          h(
            "span.lm-folder-chip",
            null,
            icon("folder"),
            f,
            iconButton("x", `Stop looking in ${f}`, () => void app.local.removeFolder(f)),
          ),
        ),
        h(
          "button.desk-btn.desk-btn-quiet",
          { type: "button", onClick: () => void pickFolder() },
          icon("plus"),
          "Add a folder",
        ),
        h("div.lm-head-spacer"),
        h(
          "button.desk-btn.desk-btn-quiet",
          { type: "button", disabled: libraryScanning, onClick: () => void app.local.scan() },
          icon("refresh"),
          libraryScanning ? "Looking…" : "Look again",
        ),
      ),
      local.length
        ? h(
            "div.desk-card.lm-server-card",
            null,
            h(
              "table.desk-table.lm-model-table.lm-lib-table",
              null,
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  ["Model", "Size", "Quantization", "On disk", "Context", "Memory", ""].map((t) =>
                    h("th", null, t),
                  ),
                ),
              ),
              h("tbody", null, local.map(row)),
            ),
          )
        : h(
            "div.desk-card.lm-lib-empty",
            null,
            h("div.lm-empty-mark", null, icon("cube")),
            h(
              "h2.lm-card-title",
              null,
              libraryScanning ? "Looking for model files…" : "No model files yet",
            ),
            h(
              "p.lm-muted",
              null,
              "Download a model in Discover, or add a folder that holds .gguf files. The built-in engine runs them with llama.cpp.",
            ),
          ),
    );
    const m = local.find((x) => x.path === chosen);
    el.dataset.detail = m ? "1" : "";
    if (m) drawDetail(m);
    else detail.replaceChildren();
  }

  S.on(["local", "engines", "memory", "folders", "libraryScanning"], draw);
  draw();
  return { el };
}
