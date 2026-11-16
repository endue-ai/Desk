// One Hugging Face repository in Discover: what it is (parameters, architecture, context, license,
// downloads), each quantization's files with their size and whether they fit, the one suggested,
// Download (for the built-in engine) or Pull (into Ollama), and the model card.
import { fill, h, icon, iconButton } from "./dom.js";
import { targetOf } from "./downloads.js";
import { bestQuant, pageOf, repoCaps } from "./hub.js";
import { renderMarkdown } from "./markdown.js";
import { FIT_WORDS, fitOf, kvBytes } from "./memory.js";
import { formatBytes, formatContext } from "./models.js";
import { CAPS } from "./view-picker.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./hub.js").HubDetails} HubDetails
 */

/** 1_234_567 → "1.2M". @param {number} n */
export const count = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

/** "4.0B parameters". @param {number | undefined} n */
const paramWords = (n) =>
  !n ? undefined : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : `${Math.round(n / 1e6)}M`;

/** @param {App} app @param {HubDetails} d @param {string} card */
export function hubModelView(app, d, card) {
  const { S } = app;
  const mem = S.get().memory;
  // The cache for an 8K context, about: a tenth of the weights for most models of this size.
  const fitting = (/** @type {number} */ size) =>
    fitOf(size + Math.max(size * 0.08, kvBytes({}, 8192)) + 600_000_000, mem);
  const best = bestQuant(d.quants, fitting);
  const ollama = S.get().servers.find((s) => s.kind === "ollama" && s.status === "online");
  const onDisk = new Set(S.get().local.map((m) => m.path));
  const caps = repoCaps(d.repo);
  const body = h("div.lm-card-body.lm-md");
  renderMarkdown(body, card || "_This repository has no model card._", {
    onLink: (url) => void app.openLink(url),
  });

  /** @param {import("./hub.js").HubQuant} q */
  const row = (q) => {
    const f = fitting(q.size);
    const target = targetOf(d.repo.id, q.files[0]);
    const have = onDisk.has(target);
    const dl = S.get().downloads.find((x) => x.id === `file:${d.repo.id}:${q.quant}`);
    return h(
      "tr",
      { dataset: { best: q === best ? "1" : undefined } },
      h(
        "td",
        null,
        h("span.desk-badge", null, q.quant),
        q === best
          ? h(
              "span.lm-best",
              { title: "The best of these that fits this computer" },
              icon("sparkle"),
              "Suggested",
            )
          : null,
      ),
      h(
        "td",
        null,
        formatBytes(q.size),
        q.parts > 1 ? h("span.lm-muted", null, ` · ${q.parts} parts`) : null,
      ),
      h(
        "td",
        null,
        f === "unknown" ? "—" : h("span.lm-fit-chip", { dataset: { fit: f } }, FIT_WORDS[f]),
      ),
      h(
        "td.lm-row-actions",
        null,
        have
          ? h("span.lm-have", null, icon("check"), "Downloaded")
          : dl && dl.state !== "failed"
            ? h(
                "span.lm-muted",
                null,
                dl.state === "done" ? "Done" : dl.state === "paused" ? "Paused" : "Downloading…",
              )
            : h(
                "button.desk-btn",
                {
                  type: "button",
                  onClick: () =>
                    app.local.downloads.add({
                      kind: "file",
                      name: q.quant,
                      repo: d.repo.id,
                      // A vision projector comes along, so images work once it loads.
                      files: d.projectors[0] ? [...q.files, d.projectors[0].file] : q.files,
                      quant: q.quant,
                      total: q.size + (d.projectors[0]?.size ?? 0),
                      path: target,
                    }),
                },
                icon("download"),
                "Download",
              ),
        ollama && q.parts === 1
          ? iconButton("server", `Pull into Ollama as hf.co/${d.repo.id}:${q.quant}`, () =>
              app.local.downloads.add({
                kind: "ollama",
                name: `hf.co/${d.repo.id}:${q.quant}`,
                server: ollama.id,
                total: q.size,
              }),
            )
          : null,
      ),
    );
  };

  return h(
    "article.lm-hub-model",
    null,
    h(
      "header.lm-hub-head",
      null,
      h("div.lm-hub-avatar", null, d.repo.author.slice(0, 1).toUpperCase()),
      h(
        "div.lm-hub-title",
        null,
        h("h2.lm-card-title", null, d.repo.id.split("/")[1]),
        h("span.lm-muted", null, d.repo.author),
      ),
      h("div.lm-head-spacer"),
      h(
        "button.desk-btn.desk-btn-quiet",
        { type: "button", onClick: () => void app.openLink(pageOf(d.repo.id)) },
        icon("globe"),
        "Hugging Face",
      ),
    ),
    h(
      "div.lm-hub-facts",
      null,
      [
        ["Parameters", paramWords(d.params)],
        ["Architecture", d.arch],
        ["Context", d.ctx ? formatContext(d.ctx) : undefined],
        ["License", d.license],
        ["Downloads", count(d.repo.downloads)],
        ["Likes", count(d.repo.likes)],
      ]
        .filter(([, v]) => v)
        .map(([k, v]) =>
          h("div.lm-hub-fact", null, h("span.lm-muted", null, k), h("strong", null, v)),
        ),
      caps.map((c) =>
        h("span.lm-cap-word", { dataset: { cap: c } }, icon(CAPS[c].icon), CAPS[c].label),
      ),
    ),
    d.base ? h("p.lm-muted.lm-hub-base", null, `Made from ${d.base}`) : null,
    d.repo.gated
      ? h(
          "div.lm-msg-error",
          null,
          icon("x"),
          h(
            "span",
            null,
            "This repository is gated: its files need a Hugging Face sign-in to download.",
          ),
        )
      : null,
    d.quants.length
      ? h(
          "div.desk-card.lm-server-card",
          null,
          h(
            "table.desk-table.lm-model-table.lm-quant-table",
            null,
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                ["Quantization", "Size", "This computer", ""].map((t) => h("th", null, t)),
              ),
            ),
            h("tbody", null, d.quants.map(row)),
          ),
        )
      : h("p.lm-muted", null, "No .gguf files in this repository."),
    d.projectors.length
      ? h(
          "p.lm-muted.lm-hub-base",
          null,
          icon("eye"),
          ` A vision projector (${formatBytes(d.projectors[0].size)}) comes with each download, for images.`,
        )
      : null,
    h("details.lm-hub-card", { open: true }, h("summary", null, icon("book"), "Model card"), body),
  );
}

/** Where a fresh repository view goes while its details load. */
export const loadingView = () =>
  h("div.lm-hub-loading", null, h("span.lm-spinner"), "Reading the repository…");

/** @param {HTMLElement} el @param {string} text */
export const errorView = (el, text) =>
  fill(el, h("div.lm-msg-error", null, icon("x"), h("span", null, text)));
