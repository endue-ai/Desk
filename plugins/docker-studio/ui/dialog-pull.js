// Pull an image: search the registry (docker search) as you type, official images marked and their
// stars counted, pick one and a tag, and watch each layer download and extract. Tagging and
// pushing an image show the same progress.

import { button, h, icon, pill } from "./dom.js";
import { field, input } from "./form.js";
import { bytes, count } from "./format.js";
import { progressOf } from "./images.js";
import { imageName } from "./model.js";
import { jsonLines } from "./parse.js";
import { imageRef } from "./refs.js";

/** @typedef {import("./studio.js").App} App @typedef {import("./images.js").LayerProgress} LayerProgress */

/** The progress of a pull or push: one bar for the whole, one row per layer. */
export function progressView() {
  const bar = h("span.progress-fill");
  const label = h("span.progress-label");
  const layers = h("div.layer-rows");
  const said = h("p.progress-said.mono");
  const element = h(
    "div.progress-view",
    null,
    h("div.progress-head", null, label, h("div.progress-bar", null, bar)),
    layers,
    said,
  );
  return {
    element,
    /** @param {Map<string, LayerProgress>} map @param {string} line */
    update(map, line) {
      const f = progressOf(map);
      bar.style.width = `${(f * 100).toFixed(1)}%`;
      label.textContent = `${Math.round(f * 100)}% · ${map.size} layer${map.size === 1 ? "" : "s"}`;
      layers.replaceChildren(
        ...[...map.values()].map((l) => {
          const done = /complete|exists|pushed/i.test(l.status);
          const part = done ? 1 : l.total ? l.done / l.total : 0;
          return h(
            `div.layer-row${done ? ".done" : ""}`,
            null,
            h("span.mono", null, l.id),
            h("span.layer-status", null, l.status || "Waiting"),
            h(
              "span.mini-bar",
              null,
              h("span", { style: { width: `${(part * 100).toFixed(1)}%` } }),
            ),
            h(
              "small.muted",
              null,
              l.total ? `${bytes(Math.min(l.done, l.total))} / ${bytes(l.total)}` : "",
            ),
          );
        }),
      );
      if (line) said.textContent = line;
    },
    done(/** @type {boolean} */ ok, /** @type {string} */ text) {
      bar.style.width = ok ? "100%" : bar.style.width;
      label.replaceChildren(icon(ok ? "check" : "alert", 14), ` ${text}`);
      element.classList.add(ok ? "ok" : "failed");
    },
  };
}

/** @param {App} app @param {string} [preset] A reference to pull at once. */
export function openPullDialog(app, preset = "", auto = true) {
  let ref = preset;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const results = h("div.search-results", {
    role: "listbox",
    "aria-label": "Images in the registry",
  });
  const tagInput = input({ value: "latest", mono: true, label: "Tag", onInput: () => sync() });
  const refLine = h("code.cmd-line");
  const progress = progressView();
  progress.element.hidden = true;
  const pullBtn = button({
    label: "Pull",
    icon: "download",
    kind: "desk-btn-primary",
    onClick: () => void go(),
  });
  const local = new Set(app.store.state.images.flatMap((i) => i.refs));

  const chosen = () => {
    const name = ref.trim();
    if (!name) return "";
    return name.includes(":") || name.includes("@")
      ? name
      : `${name}:${tagInput.value.trim() || "latest"}`;
  };
  const sync = () => {
    const r = chosen();
    refLine.textContent = r ? `docker pull ${r}` : "Choose an image";
    pullBtn.disabled = !r;
    for (const el of results.querySelectorAll(".result"))
      el.classList.toggle("chosen", /** @type {HTMLElement} */ (el).dataset.name === ref);
  };

  const search = async (/** @type {string} */ term) => {
    if (term.trim().length < 2)
      return results.replaceChildren(h("p.muted.pad", null, "Type two letters or more to search."));
    results.replaceChildren(h("p.muted.pad", null, h("span.spinner"), " Searching…"));
    try {
      const { stdout } = await app.docker(
        ["search", "--limit", "25", "--format", "{{json .}}", "--", term.trim()],
        { timeoutMs: 20_000 },
      );
      const found = jsonLines(stdout);
      results.replaceChildren(
        ...found.map((r) =>
          h(
            "button.desk-btn.desk-btn-quiet.result",
            {
              type: "button",
              role: "option",
              dataset: { name: String(r.Name) },
              onClick: () => {
                ref = String(r.Name);
                sync();
              },
            },
            h(
              "span.result-icon",
              null,
              icon(r.IsOfficial === true || r.IsOfficial === "true" ? "shield" : "layers", 16),
            ),
            h(
              "span.result-text",
              null,
              h(
                "b",
                null,
                String(r.Name),
                r.IsOfficial === true || r.IsOfficial === "true"
                  ? pill("Official", "accent")
                  : null,
                [...local].some((l) => l.startsWith(`${r.Name}:`)) ? pill("Here", "ok") : null,
              ),
              h("small", null, String(r.Description ?? "")),
            ),
            h("span.stars", null, icon("star", 13), count(Number(r.StarCount ?? 0))),
          ),
        ),
      );
      if (found.length === 0) results.append(h("p.muted.pad", null, "Nothing found."));
      sync();
    } catch (error) {
      results.replaceChildren(
        h("p.error-text.pad", null, String(/** @type {any} */ (error)?.message ?? error)),
      );
    }
  };

  const searchBox = input({
    value: preset,
    placeholder: "Search images, or type a full reference (ghcr.io/org/app:1.2)",
    label: "Image",
    onInput: (v) => {
      ref = v.trim();
      sync();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void search(v), 350);
    },
  });
  const body = h(
    "div.pull-form",
    null,
    h("label.search-wrap.wide", null, icon("search"), searchBox),
    results,
    h(
      "div.form-grid",
      null,
      field("Tag", tagInput, "Used when the name has none"),
      h("div.field", null, h("span.field-label", null, "Pulls"), refLine),
    ),
    progress.element,
  );
  const dialog = app.overlay.dialog({
    title: "Pull an image",
    subtitle: "From Docker Hub or any registry this engine can reach",
    icon: "download",
    wide: true,
    body,
    actions: [
      button({ label: "Close", kind: "desk-btn-quiet", onClick: () => dialog.close() }),
      pullBtn,
    ],
  });

  const go = async () => {
    const r = chosen();
    try {
      imageRef(r);
    } catch (error) {
      return app.toast(String(/** @type {any} */ (error)?.message), "danger");
    }
    pullBtn.disabled = true;
    progress.element.hidden = false;
    results.hidden = true;
    const ok = await app.images.transfer("pull", r, (layers, line) =>
      progress.update(layers, line),
    );
    progress.done(ok, ok ? `Pulled ${r}` : "The pull failed");
    pullBtn.disabled = false;
    if (ok)
      pullBtn.replaceWith(
        button({
          label: "Run it",
          icon: "play",
          kind: "desk-btn-primary",
          onClick: () => {
            dialog.close();
            app.dialogs.run(r);
          },
        }),
      );
  };

  sync();
  if (preset && auto) void go();
  else void search(preset);
}

/** Tag an image under a new name, then offer to push it. @param {App} app @param {import("./parse.js").Image} image */
export function openTagDialog(app, image) {
  let target = image.refs[0] ?? "";
  const progress = progressView();
  progress.element.hidden = true;
  const box = input({
    value: target,
    mono: true,
    label: "New reference",
    onInput: (v) => {
      target = v.trim();
    },
  });
  const tagBtn = button({
    label: "Tag",
    icon: "tag",
    onClick: () => void app.images.tag(image, target),
  });
  const pushBtn = button({
    label: "Tag and push",
    icon: "upload",
    kind: "desk-btn-primary",
    onClick: async () => {
      if (!image.refs.includes(target) && !(await app.images.tag(image, target))) return;
      progress.element.hidden = false;
      pushBtn.disabled = true;
      const ok = await app.images.transfer("push", target, (layers, line) =>
        progress.update(layers, line),
      );
      progress.done(
        ok,
        ok ? `Pushed ${target}` : "The push failed: is this engine logged in to the registry?",
      );
      pushBtn.disabled = false;
    },
  });
  const dialog = app.overlay.dialog({
    title: `Tag ${imageName(image)}`,
    subtitle: "Give it another name, for a registry: registry.example.com/team/app:1.0",
    icon: "tag",
    body: [
      field("New reference", box, "name[:tag], with the registry's host first to push there"),
      progress.element,
    ],
    actions: [
      button({ label: "Close", kind: "desk-btn-quiet", onClick: () => dialog.close() }),
      tagBtn,
      pushBtn,
    ],
  });
}
